import * as cdk from '@aws-cdk/core'
import * as CodeBuild from '@aws-cdk/aws-codebuild'
import * as CodePipeline from '@aws-cdk/aws-codepipeline'
import * as CodePipelineActions from '@aws-cdk/aws-codepipeline-actions'
import * as cloudformation from '@aws-cdk/aws-cloudformation'
import * as iam from '@aws-cdk/aws-iam'
import * as s3 from '@aws-cdk/aws-s3'
import * as ssm from '@aws-cdk/aws-ssm'
import { SecretValue } from '@aws-cdk/core'

/**
 * Default pipeline properties. Assumes certain values
 * come from SSM paramters.
 */
export function makeBaseProps(
  scope: cdk.Construct,
  service: string,
  branch: string
): BuildPipelineProps {
  const ssmResources = [service, 'common'].map(p => `/cicd/${p}/*`)

  return {
    branch,
    branchTools: branch,
    repoTools: 'maketools',
    email: 'ssm:/cicd/common/notification/email',
    repo: `ssm:/cicd/${service}/github/repo`,
    user: 'ssm:/cicd/common/github/owner',
    npmtoken: '/cicd/common/github/npmtoken',
    codebuildSecret: cdk.SecretValue.secretsManager('codebuild/github/token'),
    lambdaBucket: 'ssm:/cicd/common/lambdaBucket',
    stackNameDev: `${service}-dev`,
    stackNameLive: `${service}-live`,
    codeBuildSsmResourcePaths: ssmResources,
  }
}
/**
 * Pipeline with two stages, dev and live
 * Live requires approval
 */
export interface BuildPipelineProps {
  /**
   * GitHub user
   */
  readonly user: string
  /**
   * GitHub repo
   */
  readonly repo: string
  readonly branch: string
  // GitHub repo with tools (e.g. maketools)
  readonly repoTools: string
  // Branch name (e.g. master)
  readonly branchTools: string
  // Plaintext SSM path to secure string token (passed to CodeBuild)
  readonly npmtoken: string
  readonly email: string
  // Secret with GitHub token for CodeBuild (cdk.SecretValue.secretsManager). For pipeline webhook.
  readonly codebuildSecret: SecretValue
  readonly lambdaBucket: string
  // Name of dev CFN deploy stack (e.g. orders-dev)
  readonly stackNameDev: string
  // Name of dev CFN deploy stack (e.g. orders-live)
  readonly stackNameLive: string
  // Array of SSM param paths that need GetParameters permissions (/cicd/common/*, etc.)
  // Needed for reading npmtoken, etc.
  readonly codeBuildSsmResourcePaths?: string[]
}

/**
 * OrdersAPI Pipeline
 */
export class BuildPipeline extends cdk.Construct {
  // private readonly props: BuildPipelineProps

  constructor(scope: cdk.Construct, id: string, private readonly props: BuildPipelineProps) {
    super(scope, id)

    const ssmVal = ssm.StringParameter.valueForStringParameter.bind(null, scope)

    // Expand "ssm:" entries. This is deferred because they are validated up front.
    const SSM_SCHEME = 'ssm:'
    for (const [key, val] of Object.entries(props)) {
      if (typeof val == 'string' && val.startsWith(SSM_SCHEME)) {
        props[key] = ssmVal(val.slice(SSM_SCHEME.length))
      }
    }

    // Where cloned source goes
    const outputSources = new CodePipeline.Artifact('src')
    // Where cloned tools (build helper) goes
    const outputTools = new CodePipeline.Artifact('tools')
    // Where output goes
    const outputBuild = new CodePipeline.Artifact('buildOutput')

    const serviceName = 'OrdersService'

    // External lambda package bucket
    const lambdaBucket = s3.Bucket.fromBucketName(this, 'LambdaBucket', props.lambdaBucket)

    const pipeline = new CodePipeline.Pipeline(this, 'Pipeline', {
      pipelineName: `${serviceName}Master`,
      restartExecutionOnUpdate: true,
    })

    const actionSource = new CodePipelineActions.GitHubSourceAction({
      actionName: 'Code',
      owner: props.user,
      repo: props.repo,
      oauthToken: props.codebuildSecret,
      output: outputSources,
      trigger: CodePipelineActions.GitHubTrigger.WEBHOOK,
      branch: props.branch,
    })

    // https://github.com/aws/aws-cdk/blob/d7c40c5e6209de320d2b89f27e8684bebce35cf0/packages/@aws-cdk/aws-codepipeline-actions/lib/github/source-action.ts#L123
    // Created internally. We can set modify 'filters'
    // AWS::CodePipeline::Webhook
    // See: https://docs.aws.amazon.com/cdk/latest/guide/cfn_layer.html
    // https://gist.github.com/mikebroberts/37bb031eae1d8b8c26fe87eac6aae59d
    //
    // new CodePipelineActions.CfnWebhook(scope, 'WebhookResource', {
    // <snip>
    //   filters: [
    //     {
    //       jsonPath: '$.ref',
    //       matchEquals: 'refs/heads/{Branch}',
    //     },
    //   ],
    // const cfnPipeline = pipeline.node.defaultChild as CfnPipeline
    // cfnPipeline.stages[etc.]

    const actionTools = new CodePipelineActions.GitHubSourceAction({
      actionName: 'Tools',
      owner: props.user,
      repo: props.repoTools,
      oauthToken: props.codebuildSecret,
      output: outputTools,
      branch: props.branchTools,
      trigger: CodePipelineActions.GitHubTrigger.NONE,
    })

    // SRC paths end up using action name in env var:
    //
    // CODEBUILD_SRC_DIR=/codebuild/output/src405/src/s3/00
    // CODEBUILD_SRC_DIR_tools=/codebuild/output/src405/src/s3/01
    // YAML location is /codebuild/output/src405/src/s3/00/buildspec.yml
    //

    /////////////
    // SOURCE

    pipeline.addStage({
      stageName: 'Source',
      actions: [actionSource, actionTools],
    })

    /////////////
    // CODEBUILD

    const buildProject = new CodeBuild.PipelineProject(this, 'Build', {
      projectName: serviceName,
      // badge: true, <== not supported if src comes from pipeline
      description: 'Build, test and package to create deploy template',
      environment: {
        buildImage: CodeBuild.LinuxBuildImage.STANDARD_4_0,
        computeType: CodeBuild.ComputeType.SMALL,
      },
      buildSpec: CodeBuild.BuildSpec.fromSourceFilename('buildspec.yml'),
    })

    const { account, region } = cdk.Stack.of(this)

    // Allow build to read SSM parameter
    const ssmResources = (props.codeBuildSsmResourcePaths || []).map(
      p => `arn:aws:ssm:${region}:${account}:parameter${p}`
    )
    if (ssmResources.length) {
      buildProject.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ssm:GetParameters'],
          resources: ssmResources,
        })
      )
    }

    // Allow build to package to bucket
    buildProject.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:GetObject', 's3:CreateMultipartUpload'],
        resources: [lambdaBucket.bucketArn, lambdaBucket.arnForObjects('*')],
      })
    )

    const cfnDeployTemplate = 'cfn-deploy.yml'

    const actionBuild = new CodePipelineActions.CodeBuildAction({
      actionName: 'Build',
      environmentVariables: {
        COMMIT_ID: {
          value: actionSource.variables.commitId,
        },
        COMMIT_BRANCH: {
          value: actionSource.variables.branchName,
        },
        NPM_TOKEN_PARAM_KEY: {
          type: CodeBuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: this.props.npmtoken,
        },
        SAM_DEPLOY_TEMPLATE: {
          value: cfnDeployTemplate,
        },
        PACKAGE_OUTPUT_BUCKET: {
          value: props.lambdaBucket,
        },
      },
      project: buildProject,
      input: outputSources,
      extraInputs: [
        // CODEBUILD_SRC_DIR_tools
        outputTools,
      ],
      outputs: [outputBuild],
    })

    pipeline.addStage({
      stageName: 'Build',
      actions: [actionBuild],
    })

    const commitInfo = `${actionSource.variables.branchName}_${actionSource.variables.commitId}`

    this.addStageDeployDev(pipeline, outputBuild, cfnDeployTemplate, commitInfo)
    this.addStageDeployLive(pipeline, outputBuild, cfnDeployTemplate, commitInfo)

    // Lambda needs to grant permission to events
    //  https://docs.aws.amazon.com/lambda/latest/dg/services-cloudwatchevents.html
    // const funcName = Fn.importValue('GitHubBuildStatusLambdaName')
    // const funcArn = `arn:aws:lambda:${this.region}:${this.account}:function:${funcName}`
    // const statusLambda = lambda.Function.fromFunctionArn(this, 'StatusLambda', props.funcArn)
    // stage.onStateChange('StageOnStateChange', new targets.LambdaFunction(statusLambda))
  }

  private addStageDeployDev(
    pipeline: CodePipeline.Pipeline,
    buildArtifact: CodePipeline.Artifact,
    deployTemplate: string,
    commitInfo: string
  ): void {
    const capabilities = [
      cloudformation.CloudFormationCapabilities.AUTO_EXPAND,
      cloudformation.CloudFormationCapabilities.NAMED_IAM,
    ]

    const deploy = new CodePipelineActions.CloudFormationCreateUpdateStackAction({
      actionName: 'DeployDevStack',
      stackName: this.props.stackNameDev,
      capabilities,
      adminPermissions: true,
      replaceOnFailure: true,
      parameterOverrides: {
        ApiStage: 'dev',
        CommitInfo: commitInfo,
      },
      templatePath: buildArtifact.atPath(deployTemplate),
    })
    pipeline.addStage({
      stageName: 'DeployDev',
      actions: [deploy],
    })
  }

  private addStageDeployLive(
    pipeline: CodePipeline.Pipeline,
    buildArtifact: CodePipeline.Artifact,
    deployTemplate: string,
    commitInfo: string
  ): void {
    const changeSetName = 'OrdersDeployDevChangeSet'

    const email = this.props.email

    const capabilities = [
      cloudformation.CloudFormationCapabilities.AUTO_EXPAND,
      cloudformation.CloudFormationCapabilities.NAMED_IAM,
    ]

    const changes = new CodePipelineActions.CloudFormationCreateReplaceChangeSetAction({
      actionName: 'PrepareChanges',
      stackName: this.props.stackNameLive,
      changeSetName,
      capabilities,
      adminPermissions: true,
      parameterOverrides: {
        ApiStage: 'live',
        CommitInfo: commitInfo,
      },
      templatePath: buildArtifact.atPath(deployTemplate),
      runOrder: 1,
    })

    const approve = new CodePipelineActions.ManualApprovalAction({
      actionName: 'ApproveChanges',
      notifyEmails: [email],
      additionalInformation: 'Additional information goes here',
      runOrder: 2,
    })

    const execute = new CodePipelineActions.CloudFormationExecuteChangeSetAction({
      actionName: 'ExecuteChanges',
      stackName: this.props.stackNameLive,
      changeSetName,
      runOrder: 3,
    })

    pipeline.addStage({
      stageName: 'DeployLive',
      actions: [changes, approve, execute],
    })
  }
}
