export interface WorkflowManifest {
  apiVersion: string;
  kind: string;
  metadata: WorkflowMetadata;
  spec: WorkflowSpec;
}

export interface WorkflowMetadata {
  name?: string;
  generateName?: string;
  namespace?: string;
  labels?: { [key: string]: string };
  annotations?: { [key: string]: string };
}

export interface WorkflowSpec {
  entrypoint: string;
  templates: WorkflowTemplate[];
  arguments?: WorkflowArguments;
  serviceAccountName?: string;
  volumes?: any[]; // Define more specific volume types if needed
  volumeClaimTemplates?: any[]; // Define more specific PVC types if needed
  workflowTemplateRef?: {
    name: string;
    clusterScope?: boolean;
  };
  suspend?: boolean;
  ttlStrategy?: {
    secondsAfterCompletion?: number;
    secondsAfterSuccess?: number;
    secondsAfterFailure?: number;
  };
  onExit?: string;
  parallelism?: number;
  activeDeadlineSeconds?: number;
  podGC?: {
    strategy: 'OnPodCompletion' | 'OnWorkflowCompletion';
  };
  synchronization?: {
    mutex?: {
      name: string;
    };
    semaphore?: {
      name: string;
      configMapKeyRef: {
        name: string;
        key: string;
      };
    };
  };
  metrics?: {
    prometheus?: {
      name: string;
      help: string;
      value: string;
      labels?: { [key: string]: string };
    }[];
  };
}

export interface WorkflowTemplate {
  name: string;
  inputs?: {
    parameters?: { name: string; value?: string; default?: string }[];
    artifacts?: { name: string; path: string; from?: string; s3?: any; git?: any }[];
  };
  outputs?: {
    parameters?: { name: string; value?: string; valueFrom?: { path?: string; default?: string } }[];
    artifacts?: { name: string; path: string; s3?: any; git?: any }[];
  };
  container?: {
    name?: string;
    image: string;
    command?: string[];
    args?: string[];
    env?: { name: string; value: string }[];
    resources?: {
      requests?: { cpu?: string; memory?: string };
      limits?: { cpu?: string; memory?: string };
    };
    volumeMounts?: { name: string; mountPath: string }[];
  };
  script?: {
    image: string;
    command?: string[];
    args?: string[];
    source: string;
    env?: { name: string; value: string }[];
    resources?: {
      requests?: { cpu?: string; memory?: string };
      limits?: { cpu?: string; memory?: string };
    };
    volumeMounts?: { name: string; mountPath: string }[];
  };
  resource?: {
    action: string;
    manifest?: string;
    successCondition?: string;
    failureCondition?: string;
    setOwnerReference?: boolean;
    mergeStrategy?: string;
  };
  steps?: WorkflowStep[][];
  dag?: {
    tasks: DagTask[];
    target?: string;
  };
  // Add more template types as needed (e.g., suspend, data, etc.)
}

export interface WorkflowStep {
  name: string;
  template: string;
  arguments?: WorkflowArguments;
  when?: string;
  withItems?: any[];
  withParam?: string;
  withSequence?: {
    start?: string;
    end?: string;
    format?: string;
  };
}

export interface DagTask {
  name: string;
  template: string;
  dependencies?: string[];
  arguments?: WorkflowArguments;
  when?: string;
  withItems?: any[];
  withParam?: string;
  withSequence?: {
    start?: string;
    end?: string;
    format?: string;
  };
}

export interface WorkflowArguments {
  parameters?: { name: string; value: string }[];
  artifacts?: { name: string; from: string }[];
}

export interface WorkflowStatus {
  phase: string;
  message?: string;
  startedAt: string;
  finishedAt?: string;
  nodes: { [key: string]: NodeStatus };
  // Add more status fields as needed
}

export interface NodeStatus {
  id: string;
  name: string;
  displayName?: string;
  type: string;
  phase: string;
  message?: string;
  startedAt: string;
  finishedAt?: string;
  children?: string[];
  templateName?: string;
  outputs?: {
    parameters?: { name: string; value?: string }[];
    artifacts?: { name: string; path: string }[];
  };
  // Add more node status fields as needed
}

export interface WorkflowResponse {
  apiVersion: string;
  kind: string;
  metadata: WorkflowMetadata;
  spec: WorkflowSpec;
  status?: WorkflowStatus;
}

export interface ApiResponse<T> {
  metadata: {
    resourceVersion: string;
  };
  items: T[];
}

export interface AuthConfig {
  token?: string;
}

export interface WorkflowEvent {
  type: 'ADDED' | 'MODIFIED' | 'DELETED';
  object: WorkflowResponse;
}

export interface TaskOutput {
  taskName: string;
  status: string;
  outputData?: string;
  startedAt?: string;
  finishedAt?: string;
}

export class ArgoClientError extends Error {
  constructor(message: string, public status?: number, public response?: any) {
    super(message);
    this.name = 'ArgoClientError';
  }
}
