import React, { useState, useEffect, useCallback } from 'react';
import ArgoApiClient from '../api/ArgoApiClient';
import { WorkflowManifest, WorkflowResponse, ArgoClientError } from '../types/argo';

// Initialize with empty baseUrl to use the proxy in package.json
const argoClient = new ArgoApiClient();

const sampleWorkflowManifest: WorkflowManifest = {
  apiVersion: 'argoproj.io/v1alpha1',
  kind: 'Workflow',
  metadata: {
    generateName: 'dag-pipeline-',
    namespace: 'argo',
  },
  spec: {
    entrypoint: 'dag-pipeline',
    templates: [
      {
        name: 'dag-pipeline',
        dag: {
          tasks: [
            {
              name: 'task-a',
              template: 'process-task',
              arguments: {
                parameters: [
                  { name: 'input-data', value: 'initial-data' }
                ]
              }
            },
            {
              name: 'task-b',
              template: 'process-task',
              dependencies: ['task-a'],
              arguments: {
                parameters: [
                  { name: 'input-data', value: '{{tasks.task-a.outputs.parameters.output-data}}' }
                ]
              }
            },
            {
              name: 'task-c',
              template: 'process-task',
              dependencies: ['task-b'],
              arguments: {
                parameters: [
                  { name: 'input-data', value: '{{tasks.task-b.outputs.parameters.output-data}}' }
                ]
              }
            }
          ]
        }
      },
      {
        name: 'process-task',
        inputs: {
          parameters: [
            { name: 'input-data' }
          ]
        },
        outputs: {
          parameters: [
            { 
              name: 'output-data',
              valueFrom: {
                path: '/tmp/output'
              }
            }
          ]
        },
        script: {
          image: 'python:3.9-alpine',
          command: ['python'],
          source: `
import sys
input_data = "{{inputs.parameters.input-data}}"
processed_data = f"{input_data}-processed"
print(processed_data)
with open('/tmp/output', 'w') as f:
    f.write(processed_data)
          `
        }
      }
    ]
  }
};
const WorkflowManager: React.FC = () => {
  const [workflows, setWorkflows] = useState<WorkflowResponse[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string>('');
  const [namespace, setNamespace] = useState<string>('argo');
  const [workflowToSubmit, setWorkflowToSubmit] = useState<string>(JSON.stringify(sampleWorkflowManifest, null, 2));
  const [taskOutputs, setTaskOutputs] = useState<{ [taskName: string]: string }>({});
  const [connectionStatus, setConnectionStatus] = useState<string>('');
  const [isConnected, setIsConnected] = useState<boolean>(false);

  const testConnection = async () => {
    setLoading(true);
    setError(null);
    setConnectionStatus('Testing connection...');
    
    try {
      const healthResult = await argoClient.checkHealth();
      if (healthResult.isHealthy) {
        setConnectionStatus('✅ Connection successful!');
        return healthResult;
      } else {
        setConnectionStatus(`❌ Connection failed: ${healthResult.error}`);
        return healthResult;
      }
    } catch (err: any) {
      setConnectionStatus(`❌ Connection test failed: ${err.message}`);
      return { isHealthy: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };
  
  // Disconnect function
  const disconnectStream = () => {
    setIsConnected(false);
    setConnectionStatus('Disconnected');
  };

  const listWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await argoClient.listWorkflows(namespace);
      const workflowsList = response.items || [];
      setWorkflows(workflowsList);
      
      // Fetch task outputs for each workflow that has finished tasks
      for (const workflow of workflowsList) {
        if (workflow.status?.nodes && workflow.metadata.name) {
          // Check if any node has succeeded
          const hasSucceededNodes = Object.values(workflow.status.nodes).some(
            node => node.phase === 'Succeeded'
          );
          
          if (hasSucceededNodes) {
            await fetchWorkflowTaskOutputs(workflow.metadata.name);
          }
        }
      }
    } catch (err: any) {
      if (err instanceof ArgoClientError) {
        setError(`Error listing workflows: ${err.message} (Status: ${err.status})`);
      } else {
        setError(`An unexpected error occurred: ${err.message}`);
      }
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    argoClient.setAuthToken(authToken);
  }, [authToken]);

  // Start streaming workflow events when component mounts
  useEffect(() => {
    if (!isConnected || !authToken) return;
    
    console.log(`Starting to fetch workflow events, namespace: ${namespace}`);
    argoClient.setAuthToken(authToken);
    
    // Display connection status
    setConnectionStatus('⏳ Connecting to workflow events...');
    
    // Add timeout handling
    const connectionTimeout = setTimeout(() => {
      console.log('Connection timeout, possible network issues');
      setConnectionStatus('❌ Connection timeout! Try reconnecting or check network settings.');
    }, 15000); // 15秒超时
    
    // Use the modified streamWorkflowEvents method
    const eventStream = argoClient.streamWorkflowEvents(
      namespace,
      // Message handler function
      async (event) => {
        console.log('Received workflow event:', event);
        // Clear timeout timer after receiving event
        clearTimeout(connectionTimeout);
        
        try {
          const data = JSON.parse(event.data);
          console.log('Workflow event parsed successfully:', data);
          
          // Update connection status
          setConnectionStatus('✅ Real-time updates connected, receiving...');
          
          // Process workflow update events
          if (data.result && data.result.object && data.result.object.metadata && data.result.object.status) {
            const workflow = data.result.object;
            
            // Update workflow list
            setWorkflows(prevWorkflows => {
              const index = prevWorkflows.findIndex(w => w.metadata.name === workflow.metadata.name);
              if (index === -1) {
                return [...prevWorkflows, workflow];
              } else {
                const updatedWorkflows = [...prevWorkflows];
                updatedWorkflows[index] = workflow;
                return updatedWorkflows;
              }
            });
            
            // Extract outputs from successful nodes
            if (workflow.status.nodes) {
              Object.values(workflow.status.nodes).forEach(async (node: any) => {
                // Process nodes that have completed successfully and have outputs
                if (node.phase === 'Succeeded' && node.outputs && node.outputs.parameters) {
                  node.outputs.parameters.forEach((param: any) => {
                    if (param.name === 'output-data' && param.value) {
                      console.log(`Node ${node.name} output: ${param.value}`);
                      setTaskOutputs(prev => ({
                        ...prev,
                        [node.name]: param.value
                      }));
                    }
                  });
                }
                
                // Process failed nodes, display error message
                if (node.phase === 'Failed' && node.message) {
                  console.log(`Node ${node.name} failed: ${node.message}`);
                  setTaskOutputs(prev => ({
                    ...prev,
                    [node.name]: `Error: ${node.message}`
                  }));
                }
                
                // If node is running, display its status
                if (node.phase === 'Running') {
                  console.log(`Node ${node.name} is running`);
                }
                
                // If this is a completed container/Pod node (success or failure), get its logs
                if ((node.type === 'Pod' || node.type === 'Container') && 
                    (node.phase === 'Succeeded' || node.phase === 'Failed') && 
                    workflow.metadata.name && node.id) {
                  try {
                    console.log(`Getting logs for node ${node.name} (${node.id})`);
                    const logs = await argoClient.getWorkflowLogs(workflow.metadata.name, node.id, namespace);
                    console.log(`Logs for ${node.name}:`, logs);
                    
                    // Check if logs are empty
                    if (!logs || logs.trim() === '') {
                      console.log(`Logs for ${node.name} are empty`);
                      return; // Skip current callback iteration
                    }
                    
                    // Try to extract useful information from logs
                    const outputMatch = logs.match(/output-data: (.+)$/m);
                    if (outputMatch && outputMatch[1] && node.phase === 'Succeeded') {
                      console.log(`Found output in logs for ${node.name}: ${outputMatch[1]}`);
                      setTaskOutputs(prev => ({
                        ...prev,
                        [node.name]: outputMatch[1].trim()
                      }));
                    }
                  } catch (error: any) {
                    console.error(`Error getting logs for ${node.name}:`, error);
                    // More friendly error handling
                    setTaskOutputs(prev => ({
                      ...prev,
                      [node.name]: `Could not get logs: ${error.message || 'Unknown error'}`
                    }));
                  }
                }
              });
            }
          }
        } catch (error) {
          console.error('Error processing workflow event:', error);
          setConnectionStatus('❌ Error processing event, check console');
        }
      },
      // Error handler function
      (error) => {
        console.error('Workflow event stream error:', error);
        // Clear timeout timer
        clearTimeout(connectionTimeout);
        
        if (error.message && error.message.includes('401')) {
          setConnectionStatus(`❌ Authorization failed (401 Unauthorized)! Please check if your token is correct.`);
          disconnectStream(); // Disconnect
        } else {
          setConnectionStatus(`❌ Connection error! Automatically trying to reconnect...`);
        }
      }
    );
    
    // Cleanup function - stop event stream
    return () => {
      console.log('Closing workflow event stream');
      eventStream.stop();
      setIsConnected(false);
      // Clear timeout timer
      clearTimeout(connectionTimeout);
    };
  }, [namespace, authToken, isConnected]);

  // Refresh workflow and update namespace
  const freshArgoWorkflow = () => {
    try {
      const freshManifest = { ...sampleWorkflowManifest };
      freshManifest.metadata.namespace = namespace;
      setWorkflowToSubmit(JSON.stringify(freshManifest, null, 2));
    } catch (err: any) {
      console.error('Error refreshing workflow:', err);
      setError(`Error refreshing workflow: ${err.message}`);
    }
  };

  const handleSubmitWorkflow = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('Parsing workflow manifest...');
      const parsedManifest: WorkflowManifest = JSON.parse(workflowToSubmit);
      console.log('Parsed manifest:', parsedManifest);
      
      console.log('Submitting workflow...');
      const submittedWorkflow = await argoClient.submitWorkflow(parsedManifest, namespace);
      console.log('Workflow submitted successfully:', submittedWorkflow);
      
      alert(`Workflow ${submittedWorkflow.metadata.name} submitted successfully!`);
      listWorkflows(); // Refresh the list
    } catch (err: any) {
      console.error('Submit workflow error:', err);
      if (err instanceof ArgoClientError) {
        let errorMessage = `Error submitting workflow: ${err.message}`;
        if (err.status) {
          errorMessage += ` (Status: ${err.status})`;
        }
        if (err.response) {
          errorMessage += `\nResponse: ${JSON.stringify(err.response, null, 2)}`;
        }
        setError(errorMessage);
      } else if (err instanceof SyntaxError) {
        setError(`JSON parsing error: ${err.message}. Please check your workflow manifest format.`);
      } else {
        setError(`An unexpected error occurred: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWorkflow = async (name: string) => {
    if (!window.confirm(`Are you sure you want to delete workflow "${name}"?`)) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await argoClient.deleteWorkflow(name, namespace);
      alert(`Workflow "${name}" deleted successfully!`);
      listWorkflows(); // Refresh the list
    } catch (err: any) {
      if (err instanceof ArgoClientError) {
        setError(`Error deleting workflow: ${err.message} (Status: ${err.status})`);
      } else {
        setError(`An unexpected error occurred: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAllWorkflows = async () => {
    if (!window.confirm(`Are you sure you want to delete ALL workflows in namespace "${namespace}"?`)) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await argoClient.deleteAllWorkflows(namespace);
      if (result.errors.length > 0) {
        setError(`Deleted ${result.deleted} workflows, but encountered ${result.errors.length} errors:\n${result.errors.join('\n')}`);
      } else {
        alert(`Successfully deleted ${result.deleted} workflows!`);
      }
      listWorkflows(); // Refresh the list
    } catch (err: any) {
      if (err instanceof ArgoClientError) {
        setError(`Error deleting workflows: ${err.message} (Status: ${err.status})`);
      } else {
        setError(`An unexpected error occurred: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Function to fetch task outputs for a workflow
  const fetchWorkflowTaskOutputs = async (workflowName: string) => {
    try {
      const workflow = await argoClient.getWorkflow(workflowName, namespace);
      
      if (workflow.status?.nodes) {
        const newOutputs: { [key: string]: string } = {};
        const fetchPromises: Promise<void>[] = [];
        
        // For each completed node, try to get its outputs
        Object.values(workflow.status.nodes).forEach(node => {
          if (node.phase === 'Succeeded') {
            // First check if the node has output parameters directly in the status
            if (node.outputs?.parameters) {
              node.outputs.parameters.forEach((param: any) => {
                if (param.name === 'output-data' && param.value) {
                  newOutputs[node.name] = param.value;
                }
              });
            }
            
            // If there's a pod name, we can try to get logs which might contain the output
            if (node.type === 'Pod' && workflow.metadata.name && node.id) {
              const fetchPromise = argoClient.getWorkflowLogs(workflow.metadata.name, node.id, namespace)
                .then(logs => {
                  console.log(`Logs for ${node.name}:`, logs);
                  // Simple extraction of output from logs - might need to be adjusted based on actual log format
                  const outputMatch = logs.match(/output-data: (.+)$/m);
                  if (outputMatch && outputMatch[1]) {
                    newOutputs[node.name] = outputMatch[1].trim();
                  }
                })
                .catch(error => {
                  console.error(`Error fetching logs for ${node.name}:`, error);
                });
              
              fetchPromises.push(fetchPromise);
            }
          }
        });
        
        // Wait for all log fetching to complete
        await Promise.all(fetchPromises);
        
        console.log("newOutput:", newOutputs);
        // Update task outputs state with new outputs
        if (Object.keys(newOutputs).length > 0) {
          setTaskOutputs(prev => ({
            ...prev,
            ...newOutputs
          }));
          console.log('Updated task outputs:', newOutputs);
        }
      }
    } catch (error) {
      console.error('Error fetching workflow task outputs:', error);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Argo Workflow Manager</h1>

      <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '8px' }}>
        <h2>Configuration</h2>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>Auth Token (Bearer):</label>
          <input
            type="text"
            value={authToken}
            onChange={(e) => {
              // Clean token, remove trailing % and any whitespace
              const cleanToken = e.target.value.replace(/%+$/, '').trim();
              setAuthToken(cleanToken);
            }}
            placeholder="Enter Argo API Token"
            style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>Namespace:</label>
          <input
            type="text"
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            placeholder="Enter Kubernetes Namespace"
            style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
          />
        </div>
        <button onClick={listWorkflows} disabled={loading} style={{ padding: '10px 15px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', marginRight: '10px' }}>
          {loading ? 'Loading...' : 'List Workflows'}
        </button>
        <button 
          onClick={freshArgoWorkflow} 
          style={{ 
            padding: '10px 15px', 
            backgroundColor: '#6c757d', 
            color: 'white', 
            border: 'none', 
            borderRadius: '5px', 
            cursor: 'pointer',
            marginRight: '10px'
          }}
        >
          Fresh ArgoWorkflow
        </button>
        <button 
          onClick={isConnected ? disconnectStream : async () => {
            if (authToken) {
              // Check if token ends with %, which might indicate the token is truncated
              if (authToken.endsWith('%')) {
                setError("Your token may be incomplete, ending with % character. Please copy the complete token again.");
                return;
              }
              
              // Remove possible trailing whitespace
              const cleanToken = authToken.trim();
              console.log('Setting auth token:', cleanToken.substring(0, 10) + '...');
              argoClient.setAuthToken(cleanToken);
              
              // Simple test if token is valid
              try {
                const result = await testConnection();
                if (result.isHealthy) {
                  setIsConnected(true);
                } else {
                  setError(`Connection test failed: ${result.error || 'Unknown error'}`);
                }
              } catch (error: any) {
                setError(`Error connecting: ${error.message || 'Unknown error'}`);
              }
            } else {
              setError("Please enter a valid Auth Token first");
            }
          }} 
          disabled={loading || (!authToken && !isConnected)} 
          style={{ 
            padding: '10px 15px', 
            backgroundColor: isConnected ? '#dc3545' : '#28a745', 
            color: 'white', 
            border: 'none', 
            borderRadius: '5px', 
            cursor: 'pointer'
          }}
        >
          {isConnected ? 'Disconnect' : 'Connection'}
        </button>
        {connectionStatus && (
          <div style={{ marginTop: '10px', padding: '10px', backgroundColor: connectionStatus.includes('✅') ? '#d4edda' : '#f8d7da', border: '1px solid', borderColor: connectionStatus.includes('✅') ? '#c3e6cb' : '#f5c6cb', borderRadius: '5px' }}>
            {connectionStatus}
            {connectionStatus.includes('SSL Certificate error') && (
              <div style={{ marginTop: '10px', fontSize: '14px' }}>
                <strong>🔧 How to fix SSL Certificate error:</strong>
                <ol style={{ marginTop: '5px', paddingLeft: '20px' }}>
                  <li>Click the "Accept Certificate" button above</li>
                  <li>In the new tab, click "Advanced" on the security warning</li>
                  <li>Click "Proceed to localhost (unsafe)"</li>
                  <li>Close that tab and try "Test Connection" again</li>
                </ol>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '8px' }}>
        <h2>Submit New Workflow</h2>
        <textarea
          value={workflowToSubmit}
          onChange={(e) => setWorkflowToSubmit(e.target.value)}
          rows={15}
          style={{ width: '100%', padding: '10px', marginBottom: '10px', boxSizing: 'border-box', fontFamily: 'monospace' }}
        ></textarea>
        <button onClick={handleSubmitWorkflow} disabled={loading} style={{ padding: '10px 15px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
          {loading ? 'Submitting...' : 'Submit Workflow'}
        </button>
      </div>

      <h2>Existing Workflows</h2>
      {error && (
        <div style={{ 
          backgroundColor: '#f8d7da', 
          color: '#721c24', 
          padding: '12px', 
          border: '1px solid #f5c6cb', 
          borderRadius: '5px', 
          marginBottom: '20px',
          whiteSpace: 'pre-wrap',
          fontFamily: 'monospace',
          fontSize: '14px'
        }}>
          <strong>Error:</strong><br />
          {error}
        </div>
      )}
      <div style={{ marginBottom: '15px' }}>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          <button 
            onClick={handleDeleteAllWorkflows} 
            disabled={loading || workflows.length === 0} 
            style={{ 
              padding: '10px 15px', 
              backgroundColor: '#dc3545', 
              color: 'white', 
              border: 'none', 
              borderRadius: '5px', 
              cursor: 'pointer', 
              opacity: workflows.length === 0 ? 0.6 : 1
            }}
          >
            Delete All Workflows
          </button>
        </div>
        <div style={{
          padding: '10px',
          backgroundColor: '#e9f7fe',
          border: '1px solid #bee5eb',
          borderRadius: '5px',
          fontSize: '14px',
          marginBottom: '10px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ 
              marginRight: '10px', 
              fontSize: '16px', 
              display: 'inline-block',
              animation: 'pulse 1.5s infinite'
            }}>🔄</span>
            <span>
              <strong>Real-time updates active</strong>: Workflow status and task outputs are automatically updated as tasks complete. No manual refresh needed.
            </span>
          </div>
        </div>
      </div>
      {loading && <p>Loading workflows...</p>}
      {!loading && workflows.length === 0 && <p>No workflows found in namespace "{namespace}".</p>}
      {!loading && workflows.length > 0 && (
        <ul style={{ listStyleType: 'none', padding: 0 }}>
          {workflows.map((wf) => (
            <li key={wf.metadata.name} style={{ border: '1px solid #eee', padding: '10px', marginBottom: '10px', borderRadius: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>Name:</strong> {wf.metadata.name} <br />
                <strong>Phase:</strong> <span style={{ 
                  fontWeight: 'bold', 
                  color: wf.status?.phase === 'Succeeded' ? '#28a745' : 
                         wf.status?.phase === 'Failed' ? '#dc3545' : 
                         wf.status?.phase === 'Running' ? '#007bff' : '#6c757d'
                }}>
                  {wf.status?.phase || 'N/A'}
                </span> <br />
                <strong>Started:</strong> {wf.status?.startedAt ? new Date(wf.status.startedAt).toLocaleString() : 'N/A'} <br />
                {wf.status?.finishedAt && <><strong>Finished:</strong> {new Date(wf.status.finishedAt).toLocaleString()} <br /></>}
                
                {wf.status?.nodes && (
                <div style={{ marginTop: '10px' }}>
                  <strong>Tasks:</strong>
                  <ul style={{ marginTop: '5px', paddingLeft: '20px' }}>
                    {Object.values(wf.status.nodes)
                      .filter(node => node.type === 'Pod' || node.type === 'Container')
                      .map((node) => (
                        <li key={node.id} style={{ 
                          marginBottom: '10px', 
                          padding: '8px', 
                          borderRadius: '4px',
                          backgroundColor: node.phase === 'Succeeded' ? '#f0fff0' : 
                                        node.phase === 'Failed' ? '#fff0f0' : 
                                        node.phase === 'Running' ? '#f0f0ff' : '#f5f5f5',
                          border: node.phase === 'Running' ? '1px solid #b8d4f5' : '1px solid #ddd'
                        }}>
                          <div style={{ fontWeight: 'bold' }}>{node.displayName || node.name}</div>
                          <div style={{ 
                            fontSize: '13px', 
                            color: node.phase === 'Succeeded' ? '#28a745' : 
                                  node.phase === 'Failed' ? '#dc3545' : 
                                  node.phase === 'Running' ? '#007bff' : '#6c757d',
                            display: 'flex',
                            alignItems: 'center',
                            marginTop: '3px'
                          }}>
                            {node.phase === 'Running' && (
                              <span style={{ 
                                display: 'inline-block', 
                                width: '12px', 
                                height: '12px', 
                                borderRadius: '50%', 
                                background: '#007bff',
                                marginRight: '5px',
                                animation: 'pulse 1.5s infinite'
                              }}></span>
                            )}
                            Status: {node.phase}
                            {node.phase === 'Running' && ' (Updating live...)'}
                          </div>
                          {node.startedAt && <div style={{ fontSize: '12px' }}>Started: {new Date(node.startedAt).toLocaleString()}</div>}
                          {node.finishedAt && <div style={{ fontSize: '12px' }}>Finished: {new Date(node.finishedAt).toLocaleString()}</div>}
                          
                          {/* For running nodes, show a progress indicator */}
                          {node.phase === 'Running' && (
                            <div style={{ 
                              marginTop: '5px',
                              padding: '5px',
                              backgroundColor: 'rgba(0, 123, 255, 0.1)',
                              borderRadius: '3px',
                              fontSize: '12px'
                            }}>
                              <div style={{ marginBottom: '5px' }}>Task is running...</div>
                              <div style={{ 
                                height: '4px', 
                                width: '100%', 
                                backgroundColor: '#e9ecef',
                                borderRadius: '2px',
                                overflow: 'hidden',
                              }}>
                                <div style={{ 
                                  height: '100%', 
                                  width: '40%',
                                  backgroundColor: '#007bff',
                                  borderRadius: '2px',
                                  animation: 'progress 2s infinite ease-in-out'
                                }}></div>
                              </div>
                            </div>
                          )}
                          
                          {taskOutputs[node.name] && (
                            <div style={{ 
                              marginTop: '5px', 
                              padding: '5px', 
                              backgroundColor: 'white', 
                              borderRadius: '3px', 
                              border: '1px solid #ddd',
                              fontFamily: 'monospace',
                              fontSize: '12px'
                            }}>
                              <strong>Output:</strong> {taskOutputs[node.name]}
                            </div>
                          )}
                        </li>
                      ))}
                  </ul>
                </div>
                )}
              </div>
              <button onClick={() => handleDeleteWorkflow(wf.metadata.name!)} disabled={loading} style={{ padding: '8px 12px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default WorkflowManager;
