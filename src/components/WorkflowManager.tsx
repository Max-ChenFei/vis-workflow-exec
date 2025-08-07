import React, { useState, useEffect, useCallback } from 'react';
import ArgoApiClient from '../api/ArgoApiClient';
import { WorkflowManifest, WorkflowResponse, ArgoClientError, WorkflowEvent, TaskOutput } from '../types/argo';

const argoClient = new ArgoApiClient(); // Initialize with default URL and no token

const sampleWorkflowManifest: WorkflowManifest = {
  apiVersion: 'argoproj.io/v1alpha1',
  kind: 'Workflow',
  metadata: {
    generateName: 'dag-pipeline-',
    namespace: 'default',
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
  const [namespace, setNamespace] = useState<string>('default');
  const [workflowToSubmit, setWorkflowToSubmit] = useState<string>(JSON.stringify(sampleWorkflowManifest, null, 2));
  const [taskOutputs, setTaskOutputs] = useState<{ [taskName: string]: string }>({});
  const [eventSource, setEventSource] = useState<EventSource | null>(null);

  const listWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await argoClient.listWorkflows(namespace);
      setWorkflows(response.items || []);
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
    listWorkflows();
  }, [authToken, listWorkflows]);

  useEffect(() => {
    const source = argoClient.streamWorkflowEvents(namespace);
    setEventSource(source);

    source.onmessage = (event) => {
      try {
        const workflowEvent: WorkflowEvent = JSON.parse(event.data);
        if (workflowEvent.type === 'MODIFIED' && workflowEvent.object.status) {
          const updatedWorkflow = workflowEvent.object;
          // Update task outputs based on the workflow status
          if (updatedWorkflow.status && updatedWorkflow.status.nodes) {
            Object.values(updatedWorkflow.status.nodes).forEach((node) => {
              if (node.phase === 'Succeeded' && node.outputs?.parameters) {
                const outputParam = node.outputs.parameters.find(p => p.name === 'output-data');
                if (outputParam) {
                  setTaskOutputs((prev) => ({
                    ...prev,
                    [node.name]: outputParam.value || 'N/A'
                  }));
                }
              }
            });
          }
        }
      } catch (err) {
        console.error('Error parsing workflow event:', err);
      }
    };

    return () => {
      source.close();
    };
  }, [namespace]);

  const handleSubmitWorkflow = async () => {
    setLoading(true);
    setError(null);
    try {
      const parsedManifest: WorkflowManifest = JSON.parse(workflowToSubmit);
      const submittedWorkflow = await argoClient.submitWorkflow(parsedManifest, namespace);
      alert(`Workflow ${submittedWorkflow.metadata.name} submitted successfully!`);
      listWorkflows(); // Refresh the list
    } catch (err: any) {
      if (err instanceof ArgoClientError) {
        setError(`Error submitting workflow: ${err.message} (Status: ${err.status})`);
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
        <button onClick={listWorkflows} disabled={loading} style={{ padding: '10px 15px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
          {loading ? 'Loading...' : 'Refresh Workflows'}
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
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading && <p>Loading workflows...</p>}
      {!loading && workflows.length === 0 && <p>No workflows found in namespace "{namespace}".</p>}
      {!loading && workflows.length > 0 && (
        <ul style={{ listStyleType: 'none', padding: 0 }}>
          {workflows.map((wf) => (
            <li key={wf.metadata.name} style={{ border: '1px solid #eee', padding: '10px', marginBottom: '10px', borderRadius: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>Name:</strong> {wf.metadata.name} <br />
                <strong>Phase:</strong> {wf.status?.phase || 'N/A'} <br />
                <strong>Started:</strong> {wf.status?.startedAt ? new Date(wf.status.startedAt).toLocaleString() : 'N/A'}
                <br />
                {wf.status?.nodes && (
                  <div>
                    <strong>Task Outputs:</strong>
                    <ul style={{ marginTop: '5px', paddingLeft: '20px' }}>
                      {Object.values(wf.status.nodes).map((node) => (
                        node.phase === 'Succeeded' && taskOutputs[node.name] ? (
                          <li key={node.name} style={{ marginBottom: '5px' }}>
                            <strong>{node.name}:</strong> {taskOutputs[node.name]}
                          </li>
                        ) : null
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
