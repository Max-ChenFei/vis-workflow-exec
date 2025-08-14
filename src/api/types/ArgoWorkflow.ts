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
  resourceVersion?: string;
}


export interface WorkflowArguments {
  parameters?: { name: string; value: string }[];
  artifacts?: { name: string; from: string }[];
}

export interface WorkflowSpec {
  entrypoint: string;
  arguments?: WorkflowArguments;
  templates: WorkflowTemplate[];
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
  dag?: {
    tasks: DagTask[];
  };
}

export interface DagTask {
  name: string;
  template: string;
  dependencies?: string[];
  arguments?: WorkflowArguments;
}