import React, { useState, useEffect, useCallback } from 'react';
import ArgoApiClient from '../api/ArgoApiClient';
import { WorkflowManifest, WorkflowResponse, ArgoClientError } from '../types/argo';

// Initialize with empty baseUrl to use the proxy in package.json
const argoClient = new ArgoApiClient();

// Helpers to sort nodes by DAG dependency order
function getDagOrderMap(wf: WorkflowResponse): Map<string, number> | null {
  try {
    const entryName = wf?.spec?.entrypoint;
    if (!entryName || !wf?.spec?.templates) return null;
    const tpl = wf.spec.templates.find(t => t.name === entryName);
    const dagTasks = tpl?.dag?.tasks;
    if (!dagTasks || dagTasks.length === 0) return null;

    // Build graph from dependencies
    const names = Array.from(new Set(dagTasks.map(t => t.name)));
    const indeg: Record<string, number> = {};
    const adj: Record<string, string[]> = {};
    names.forEach(n => { indeg[n] = 0; adj[n] = []; });
    for (const t of dagTasks) {
      const deps = t.dependencies || [];
      for (const d of deps) {
        if (!(d in adj)) { adj[d] = []; if (!(d in indeg)) indeg[d] = 0; }
        adj[d].push(t.name);
        indeg[t.name] = (indeg[t.name] ?? 0) + 1;
      }
      if (!(t.name in indeg)) indeg[t.name] = indeg[t.name] ?? 0;
    }

    // Kahn's algorithm for topological order
    const q: string[] = Object.keys(indeg).filter(k => indeg[k] === 0).sort();
    const order: string[] = [];
    while (q.length) {
      const n = q.shift()!;
      order.push(n);
      for (const v of adj[n] || []) {
        indeg[v] -= 1;
        if (indeg[v] === 0) q.push(v);
      }
      q.sort();
    }

    // Map task name -> index
    const map = new Map<string, number>();
    order.forEach((n, i) => map.set(n, i));
    return map;
  } catch {
    return null;
  }
}

function baseTaskNameFromNode(node: any): string {
  const raw = (node?.displayName || node?.name || '').toString();
  // strip loop suffix like task-a(0) or task-a (0)
  const m = raw.match(/^\s*([^\(]+)\s*(?:\(.*\))?\s*$/);
  return (m && m[1]) ? m[1].trim() : raw;
}

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
  // connection/test UI removed

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

  // streaming removed

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
      
      const fullName = submittedWorkflow.metadata.name!;
      alert(`Workflow ${fullName} submitted successfully!`);
      // Set token and add initial workflow to the list
      argoClient.setAuthToken(authToken.trim());
  // Only track the latest submitted workflow
  setTaskOutputs({});
  setWorkflows([submittedWorkflow]);

      // Start polling this workflow for updates until it finishes
      const poller = argoClient.pollWorkflow(
        fullName,
        namespace,
        async (wf) => {
          // keep only the latest workflow in list
          setWorkflows([wf]);
          // update task outputs
          if (wf.status?.nodes) {
            const nodes: any[] = Object.values(wf.status.nodes);
            for (const node of nodes) {
              if (node.phase === 'Succeeded' && node.outputs?.parameters) {
                node.outputs.parameters.forEach((param: any) => {
                  if (param.name === 'output-data' && param.value) {
                    setTaskOutputs(prev => ({ ...prev, [node.name]: param.value }));
                  }
                });
              }
              if ((node.type === 'Pod' || node.type === 'Container') &&
                  (node.phase === 'Succeeded' || node.phase === 'Failed') &&
                  wf.metadata.name && node.id) {
                try {
                  const logs = await argoClient.getWorkflowLogs(wf.metadata.name, node.id, namespace);
                  if (logs && logs.trim() !== '') {
                    const outputMatch = logs.match(/output-data: (.+)$/m);
                    if (outputMatch && outputMatch[1] && node.phase === 'Succeeded') {
                      setTaskOutputs(prev => ({ ...prev, [node.name]: outputMatch[1].trim() }));
                    }
                  }
                } catch (e) {
                  // ignore log fetch errors during polling
                }
              }
            }
          }
        },
        (err) => {
          console.error('Polling error:', err);
        },
        2000
      );
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
          <div>Submit a workflow to start live polling and see step results update here in real time.</div>
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
                      .sort((a: any, b: any) => {
                        const dagMap = getDagOrderMap(wf);
                        const ta = dagMap ? dagMap.get(baseTaskNameFromNode(a)) : undefined;
                        const tb = dagMap ? dagMap.get(baseTaskNameFromNode(b)) : undefined;
                        if (ta === undefined && tb === undefined) {
                          const na = (a.displayName || a.name || '').toString();
                          const nb = (b.displayName || b.name || '').toString();
                          return na.localeCompare(nb);
                        }
                        if (ta === undefined) return 1;
                        if (tb === undefined) return -1;
                        return ta - tb;
                      })
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
