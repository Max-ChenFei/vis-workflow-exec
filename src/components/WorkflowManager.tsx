import React, { useState, useEffect, useCallback } from 'react';
import ArgoApiClient from '../api/ArgoApiClient';
import { WorkflowEventStream, WorkflowEvent } from '../api/WorkflowEventStream';
import { WorkflowManifest, WorkflowResponse } from '../types/argo';

const argoClient = new ArgoApiClient();

const buildSampleWorkflow = (ns: string, sa: string): WorkflowManifest => ({
  apiVersion: 'argoproj.io/v1alpha1',
  kind: 'Workflow',
  metadata: {
    generateName: 'dag-pipeline-',
    namespace: ns,
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
                parameters: [ { name: 'input-data', value: 'initial-data' } ]
              }
            },
            {
              name: 'task-b',
              template: 'process-task',
              dependencies: ['task-a'],
              arguments: {
                parameters: [ { name: 'input-data', value: '{{tasks.task-a.outputs.parameters.output-data}}' } ]
              }
            },
            {
              name: 'task-c',
              template: 'process-task',
              dependencies: ['task-b'],
              arguments: {
                parameters: [ { name: 'input-data', value: '{{tasks.task-b.outputs.parameters.output-data}}' } ]
              }
            }
          ]
        }
      },
      {
        name: 'process-task',
        inputs: { parameters: [ { name: 'input-data' } ] },
        outputs: {
          parameters: [ { name: 'output-data', valueFrom: { path: '/tmp/output' } } ]
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
});

// Helper function to get color for workflow phase
const getPhaseColor = (phase: string): string => {
  switch (phase.toLowerCase()) {
    case 'pending': return '#6c757d';
    case 'running': return '#007bff';
    case 'succeeded': return '#28a745';
    case 'failed': return '#dc3545';
    case 'error': return '#dc3545';
    default: return '#6c757d';
  }
};

const WorkflowManager: React.FC = () => {
  const [workflows, setWorkflows] = useState<WorkflowResponse[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [serviceAccountName, setServiceAccountName] = useState<string>('argo-workflow');
  const [authToken, setAuthToken] = useState<string>('');
  const [namespace, setNamespace] = useState<string>('argo');
  const [workflowToSubmit, setWorkflowToSubmit] = useState<string>(
    JSON.stringify(buildSampleWorkflow('argo', 'argo-workflow'), null, 2)
  );
  const [taskOutputs, setTaskOutputs] = useState<{ [taskName: string]: string }>({});
  const [healthStatus, setHealthStatus] = useState<{ isHealthy: boolean; error?: string, status?: number } | null>(null);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [workflowEvents, setWorkflowEvents] = useState<WorkflowEvent[]>([]);
  const [eventStream, setEventStream] = useState<WorkflowEventStream | null>(null);
  const [currentWorkflowOutputs, setCurrentWorkflowOutputs] = useState<Array<{taskName: string, outputs: string[]}>>([]);


  const listWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await argoClient.listWorkflows(namespace);
      const workflowsList = response.items || [];
      setWorkflows(workflowsList);
    } catch (err: any) {
      setError(`Error listing workflows: ${err?.message || 'Unknown error'}`);
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    argoClient.setAuthToken(authToken);
  }, [authToken]);


  // Handle health check button click
  const handleHealthCheck = async (namespace: string) => {
    setLoading(true);
    try {
      const result = await argoClient.checkHealth(namespace);
      setHealthStatus(result);
    } catch (err: any) {
      setHealthStatus({ isHealthy: false, error: err.msg, status: err.status });
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
      startWorkflowEventStream(fullName);
      console.log(`Workflow ${fullName} submitted successfully!`);         
    } catch (err: any) {
      console.error('Submit workflow error:', err);
      if (err instanceof SyntaxError) {
        setError(`JSON parsing error: ${err.message}. Please check your workflow manifest format.`);
      } else {
        setError(`Error submitting workflow: ${err?.message || 'Unknown error'}`);
      }
    } finally {
      setLoading(false);
    }
  };
  // Fresh Workflow: 根据当前输入重置示例
  const handleFreshWorkflow = () => {
    const wf = buildSampleWorkflow(namespace.trim() || 'default', serviceAccountName.trim() || 'argo-workflow');
    setWorkflowToSubmit(JSON.stringify(wf, null, 2));
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
      setError(`Error deleting workflows: ${err?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const getWorkflowOutputs = (workflow: WorkflowResponse) => {
  if (!workflow.status?.nodes) return [];

  return Object.values(workflow.status.nodes)
    .filter((node: any) => node.outputs?.parameters && node.outputs.parameters.length > 0)
    .map((node: any) => ({
      taskName: node.displayName || node.name,
      outputs: node.outputs.parameters.map((p: any) => p.value)
    }));
};

  // Streaming functions
  const startWorkflowEventStream = useCallback((workflowName: string) => {
    if (eventStream) {
      eventStream.close();
    }

    const newEventStream = new WorkflowEventStream(authToken);
    setEventStream(newEventStream);
    setIsStreaming(true);
    setWorkflowEvents([]); // Clear previous events

    const cleanup = newEventStream.streamWorkflowEvents(
      namespace,
      workflowName,
      (event: WorkflowEvent) => {
        console.log('Received workflow event:', event);

        const outputs = getWorkflowOutputs(event.object);
        console.log('Workflow outputs:', outputs);
        
        // Update the current workflow outputs
        setCurrentWorkflowOutputs(outputs);

        setWorkflowEvents(prev => [...prev, event]);
        
        // We're no longer auto-updating the workflows list from streaming events
      },
      (error: Event) => {
        console.error('Workflow event stream error:', error);
        setError('Streaming connection error');
        setIsStreaming(false);
      },
      () => {
        console.log('Workflow event stream connected');
        setError(null);
      }
    );

    // Return cleanup function directly since streamWorkflowEvents returns it synchronously
    return cleanup;
  }, [authToken, namespace, eventStream]);

  const stopWorkflowEventStream = useCallback(() => {
    if (eventStream) {
      eventStream.close();
      setEventStream(null);
    }
    setIsStreaming(false);
  }, [eventStream]);



  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '8px' }}>
        <h2>Configuration</h2>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>Service Account Name:</label>
          <input
            type="text"
            value={serviceAccountName}
            onChange={(e) => setServiceAccountName(e.target.value)}
            placeholder="Enter ServiceAccount (default: argo-workflow)"
            style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
          />
        </div>
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
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', marginBottom: '5px' }}>
          <button
            onClick={() => handleHealthCheck(namespace)}
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
        </div>
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
              `${healthStatus.error}(${healthStatus.status})`
            }
          </div>
        )}
      </div>

      {/* Streaming Controls */}
      <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '8px' }}>
        <h2>Real-time Workflow Events</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
          <button
            onClick={() => startWorkflowEventStream("")}
            disabled={isStreaming}
            style={{
              padding: '10px 15px',
              backgroundColor: isStreaming ? '#6c757d' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: isStreaming ? 'not-allowed' : 'pointer'
            }}
          >
            {isStreaming ? 'Streaming Active' : 'Start Streaming'}
          </button>
          <button
            onClick={stopWorkflowEventStream}
            disabled={!isStreaming}
            style={{
              padding: '10px 15px',
              backgroundColor: !isStreaming ? '#6c757d' : '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: !isStreaming ? 'not-allowed' : 'pointer'
            }}
          >
            Stop Streaming
          </button>
          <span style={{ 
            padding: '8px 12px', 
            borderRadius: '4px',
            backgroundColor: isStreaming ? '#d4edda' : '#f8d7da',
            color: isStreaming ? '#155724' : '#721c24',
            border: isStreaming ? '1px solid #c3e6cb' : '1px solid #f5c6cb'
          }}>
            {isStreaming ? '🟢 Streaming' : '🔴 Not streaming'}
          </span>
        </div>
        
        {/* Current Workflow Outputs */}
        {workflowEvents.length > 0 && workflowEvents[workflowEvents.length-1].object && workflowEvents[workflowEvents.length-1].object.metadata && (
          <div style={{ marginTop: '15px' }}>
            <div style={{ 
              marginBottom: '10px', 
              fontWeight: 'bold', 
              display: 'flex', 
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px'
            }}>
              Workflow: {workflowEvents[workflowEvents.length-1].object.metadata.name || 'Unknown'}
              {workflowEvents[workflowEvents.length-1].object.status?.phase && (
                <span style={{ 
                  marginLeft: '10px', 
                  padding: '3px 8px', 
                  borderRadius: '4px',
                  backgroundColor: getPhaseColor(workflowEvents[workflowEvents.length-1].object.status?.phase || ''),
                  color: 'white',
                  fontSize: '12px'
                }}>
                  {workflowEvents[workflowEvents.length-1].object.status?.phase}
                </span>
              )}
            </div>
            <div style={{ 
              border: '1px solid #ddd', 
              borderRadius: '5px',
              backgroundColor: '#f8f9fa',
              maxHeight: '400px',
              overflowY: 'auto',
              padding: '15px'
            }}>
              {currentWorkflowOutputs.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#6c757d' }}>
                  No task outputs available yet.
                </div>
              ) : (
                <div className="workflow-outputs">
                  {currentWorkflowOutputs.map((task, index) => (
                    <div key={index} style={{ 
                      padding: '15px',
                      margin: '0 0 15px 0',
                      backgroundColor: 'white',
                      borderRadius: '6px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)',
                    }}>
                      <div style={{ 
                        fontWeight: 'bold', 
                        padding: '0 0 8px 0',
                        borderBottom: '1px solid #eee',
                        marginBottom: '12px',
                        fontSize: '16px',
                        color: '#333'
                      }}>
                        <span style={{
                          backgroundColor: '#007bff',
                          color: 'white',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          marginRight: '8px',
                          fontSize: '14px'
                        }}>Task</span>
                        {task.taskName}
                      </div>
                      <div>
                        <div style={{
                          fontWeight: 'bold',
                          marginBottom: '8px',
                          fontSize: '14px',
                          color: '#555'
                        }}>
                          Outputs:
                        </div>
                        {task.outputs.map((output, i) => (
                          <div key={i} style={{ 
                            padding: '8px 12px',
                            backgroundColor: '#f8f9fa',
                            borderRadius: '4px',
                            marginBottom: '8px',
                            fontFamily: 'monospace',
                            fontSize: '13px',
                            wordBreak: 'break-all',
                            border: '1px solid #e9ecef'
                          }}>
                            {output}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={handleFreshWorkflow}
            style={{
              padding: '10px 15px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer'
            }}
          >
            Fresh Workflow
          </button>
          <button onClick={handleSubmitWorkflow} disabled={loading} style={{ padding: '10px 15px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
            {loading ? 'Submitting...' : 'Submit Workflow'}
          </button>
        </div>
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
