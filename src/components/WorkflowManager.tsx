import React, { useState, useCallback } from 'react';
import { ArgoApiClient, WorkflowStatus, WorkflowManifest, ArgoRestApiResponse } from '../api';

const argoClient = new ArgoApiClient();

const buildSampleWorkflow = (): WorkflowManifest => ({
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
  const [argoResponse, setArgoResponses] = useState<ArgoRestApiResponse[]>([]);
  const [currentWorkflowStatus, setCurrentWorkflowStatus] = useState<WorkflowStatus | null>(null);

  const [workflowToSubmit, setWorkflowToSubmit] = useState<string>(
    JSON.stringify(buildSampleWorkflow(), null, 2)
  );
  

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<{ isHealthy: boolean; error?: string, status?: number } | null>(null);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);

  const handleHealthCheck = async () => {
    setLoading(true);
    try {
      const result = await argoClient.checkHealth();
      setHealthStatus(result);
    } catch (err: any) {
      setHealthStatus({ isHealthy: false, error: err.msg, status: err.status });
    } finally {
      setLoading(false);
    }
  };

  const listWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await argoClient.listWorkflows();
      const workflowsList = response.items || [];
      setArgoResponses(workflowsList);
    } catch (err: any) {
      setError(`Error listing workflows: ${err?.message || 'Unknown error'}`);
      setArgoResponses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmitWorkflow = async () => {
    setLoading(true);
    setError(null);
    try {
      const parsedManifest: WorkflowManifest = JSON.parse(workflowToSubmit);
      const submittedWorkflow = await argoClient.submitWorkflow(parsedManifest);
      const fullName = submittedWorkflow.metadata.name!;
      startWatchingWorkflow(fullName);
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

  const handleDeleteAllWorkflows = async () => {
    if (!window.confirm(`Are you sure you want to delete ALL workflows in the argo namespace?`)) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await argoClient.deleteAllWorkflows();
      if (result.errors.length > 0) {
        setError(`Deleted ${result.deleted} workflows, but encountered ${result.errors.length} errors:\n${result.errors.join('\n')}`);
      }
      listWorkflows();
    } catch (err: any) {
      setError(`Error deleting workflows: ${err?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const startWatchingWorkflow = useCallback((workflowName: string) => {
    setIsStreaming(true);
    setCurrentWorkflowStatus(null);

    const cleanup = argoClient.watchWorkflow(
      workflowName,
      (status: WorkflowStatus) => {
        console.log('Received workflow status:', status);
        setCurrentWorkflowStatus(status);
      },
      (error: Event) => {
        console.error('Workflow event stream error:', error);
        setError('Streaming connection error');
        setIsStreaming(false);
      },
      () => {
        console.log('Workflow event stream connected');
        setError(null);
      },
      () => {
        console.log('Stream auto-closed due to workflow completion');
        setIsStreaming(false);
      }
    );

    return cleanup;
  }, []);

  const stopWatchingWorkflow = useCallback(() => {
    argoClient.stopWatchingWorkflow();
    setIsStreaming(false);
  }, []);



  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '8px' }}>
        <h2>Configuration</h2>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', marginBottom: '5px' }}>
          <button
            onClick={() => handleHealthCheck()}
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

      <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '8px' }}>
        <h2>Real-time Workflow Events</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
          <button
            onClick={() => startWatchingWorkflow("")}
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
            onClick={stopWatchingWorkflow}
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
        
        {currentWorkflowStatus && (
          <div style={{ marginTop: '15px' }}>
            <div style={{ 
              marginBottom: '10px', 
              fontWeight: 'bold', 
              display: 'flex', 
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px'
            }}>
              Workflow: {currentWorkflowStatus.name}
              {currentWorkflowStatus.phase && (
                <span style={{ 
                  marginLeft: '10px', 
                  padding: '3px 8px', 
                  borderRadius: '4px',
                  backgroundColor: getPhaseColor(currentWorkflowStatus.phase),
                  color: 'white',
                  fontSize: '12px'
                }}>
                  {currentWorkflowStatus.phase}
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
              {(() => {
                if (currentWorkflowStatus.nodes.length === 0) return (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#6c757d' }}>
                    No tasks available yet.
                  </div>
                );
                
                return (
                  <div className="workflow-tasks">
                    {currentWorkflowStatus.nodes.map((node, index) => (
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
                        color: '#333',
                        display: 'flex',
                        alignItems: 'center'
                      }}>
                        <span style={{
                          backgroundColor: '#007bff',
                          color: 'white',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          marginRight: '8px',
                          fontSize: '14px'
                        }}>Task</span>
                        {node.name}
                        <span style={{ 
                          marginLeft: '10px', 
                          padding: '2px 6px', 
                          borderRadius: '3px',
                          backgroundColor: getPhaseColor(node.phase),
                          color: 'white',
                          fontSize: '11px'
                        }}>
                          {node.phase}
                        </span>
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
                        {node.outputs.length === 0 ? (
                          <div style={{ 
                            padding: '8px 12px',
                            backgroundColor: '#f8f9fa',
                            borderRadius: '4px',
                            fontStyle: 'italic',
                            color: '#6c757d',
                            border: '1px solid #e9ecef'
                          }}>
                            No outputs available yet
                          </div>
                        ) : (
                          node.outputs.map((output: string, i: number) => (
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
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                  </div>
                );
              })()}
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
            disabled={loading || argoResponse.length === 0} 
            style={{ 
              padding: '10px 15px', 
              backgroundColor: '#dc3545', 
              color: 'white', 
              border: 'none', 
              borderRadius: '5px', 
              cursor: 'pointer', 
              opacity: argoResponse.length === 0 ? 0.6 : 1
            }}
          >
            Delete All Workflows
          </button>
        </div>
      </div>
      {loading && <p>Loading workflows...</p>}
      {!loading && argoResponse.length === 0 && <p>No workflows found in the argo namespace.</p>}
      {!loading && argoResponse.length > 0 && (
        <ul style={{ listStyleType: 'none', padding: 0 }}>
          {argoResponse.map((wf) => (
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
                
                {wf.status?.nodes && (
                <div style={{ marginTop: '10px' }}>
                  <strong>Tasks:</strong>
                  <ul style={{ marginTop: '5px', paddingLeft: '20px' }}>
                    {Object.values(wf.status.nodes)
                      .map((node:any) => (
                        <li key={node.name} style={{ 
                          marginBottom: '10px', 
                          padding: '8px', 
                          borderRadius: '4px',
                          backgroundColor: node.phase === 'Succeeded' ? '#f0fff0' : 
                                        node.phase === 'Failed' ? '#fff0f0' : 
                                        node.phase === 'Running' ? '#f0f0ff' : '#f5f5f5',
                          border: node.phase === 'Running' ? '1px solid #b8d4f5' : '1px solid #ddd'
                        }}>
                          <div style={{ fontWeight: 'bold' }}>{node.name}</div>
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
