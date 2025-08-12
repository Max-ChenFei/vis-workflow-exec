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
  const [healthStatus, setHealthStatus] = useState<{ isHealthy: boolean; error?: string } | null>(null);
  // connection/test UI removed

  const listWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await argoClient.listWorkflows(namespace);
      const workflowsList = response.items || [];
      setWorkflows(workflowsList);
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

  // Handle health check button click
  const handleHealthCheck = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await argoClient.checkHealth();
      setHealthStatus(result);
      if (!result.isHealthy && result.error) {
        setError(`Health check failed: ${result.error}`);
      }
    } catch (err: any) {
      setError(`Health check error: ${err.message}`);
      setHealthStatus({ isHealthy: false, error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitWorkflow = async () => {
    setLoading(true);
    setError(null);
    try {
      const parsedManifest: WorkflowManifest = JSON.parse(workflowToSubmit);
      const submittedWorkflow = await argoClient.submitWorkflow(parsedManifest, namespace);
      const fullName = submittedWorkflow.metadata.name!;
      console.log(`Workflow ${fullName} submitted successfully!`);         
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
            onChange={(e) => setAuthToken(e.target.value)}
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
        <button 
          onClick={handleHealthCheck} 
          style={{ 
            padding: '10px 15px', 
            backgroundColor: '#17a2b8', 
            color: 'white', 
            border: 'none', 
            borderRadius: '5px', 
            cursor: 'pointer'
          }}
        >
          Check Connection
        </button>
        {healthStatus !== null && (
          <div style={{
            marginTop: '10px',
            padding: '8px',
            borderRadius: '4px',
            backgroundColor: healthStatus.isHealthy ? '#d4edda' : '#f8d7da',
            color: healthStatus.isHealthy ? '#155724' : '#721c24',
            border: healthStatus.isHealthy ? '1px solid #c3e6cb' : '1px solid #f5c6cb'
          }}>
            {healthStatus.isHealthy ? 
              '✅ Connection successful!' : 
              `❌ Connection failed: ${healthStatus.error || 'Unknown error'}`
            }
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
            onClick={listWorkflows} 
            disabled={loading} 
            style={{ 
              padding: '10px 15px', 
              backgroundColor: '#007bff', 
              color: 'white', 
              border: 'none', 
              borderRadius: '5px', 
              cursor: 'pointer'
            }}
          >
            {loading ? 'Loading...' : 'List Workflows'}
          </button>
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
          <div>Click "List Workflows" to see existing workflows in the namespace.</div>
        </div>
      </div>
      {loading && <p>Loading workflows...</p>}
      {!loading && workflows.length === 0 && <p>No workflows found in namespace "{namespace}".</p>}
      {!loading && workflows.length > 0 && (
        <ul style={{ listStyleType: 'none', padding: 0 }}>
          {workflows.map((wf) => (
            <li key={wf.metadata.name} style={{ border: '1px solid #eee', padding: '10px', marginBottom: '10px', borderRadius: '5px' }}>
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default WorkflowManager;
