import { expect as cdkExpect, haveResource } from '@aws-cdk/assert'
import { SynthUtils } from '@aws-cdk/assert'
import * as cdk from '@aws-cdk/core'
import { BuildPipeline } from '../src/buildPipeline'
import * as ssm from '@aws-cdk/aws-ssm'

test('create pipeline', () => {
  const stack = new cdk.Stack(undefined, 'MyStack', {
    env: {
      region: 'us-west-2',
      account: '1234',
    },
  })

  // Makes token (string) that resolves during deployment
  // For environment that is stored in SSM
  // They show up as "AWS::SSM::Parameter::Value<String>", etc. in CFN template
  // These are not read during synth
  const ssmVal = ssm.StringParameter.valueForStringParameter.bind(null, stack)

  // Needs to include path to npmtoken
  const ssmResources = ['ordersapi', 'common'].map(p => `/cicd/${p}/*`)

  // Params using SSM values can also be read from local env, etc. and passed as plain string
  new BuildPipeline(stack, 'test-build-pipeline', {
    branch: 'master',
    branchTools: 'master',
    repoTools: 'maketools',
    email: ssmVal('/cicd/common/notification/email'),
    repo: ssmVal('/cicd/ordersapi/github/repo'),
    user: ssmVal('/cicd/common/github/owner'),
    npmtoken: '/cicd/common/github/npmtoken',
    codebuildSecret: cdk.SecretValue.secretsManager('codebuild/github/token'),
    lambdaBucket: ssmVal('/cicd/common/lambdaBucket'),
    stackNameDev: 'orders-dev',
    stackNameLive: 'orders-live',
    codeBuildSsmResourcePaths: ssmResources,
  })

  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot()

  cdkExpect(stack).to(
    haveResource('AWS::CodePipeline::Pipeline', {
      Name: 'OrdersServiceMaster',
    })
  )
})
