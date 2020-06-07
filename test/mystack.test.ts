import { expect, haveResource } from '@aws-cdk/assert'
import * as cdk from '@aws-cdk/core'
import BuildPipeline from '../src/buildPipeline'
import * as ssm from '@aws-cdk/aws-ssm'

test('create pipeline', () => {
  const stack = new cdk.Stack()

  // Makes token (string) that resolves during deployment
  // For environment that is stored in SSM
  // They show up as "AWS::SSM::Parameter::Value<String>", etc. in CFN template
  const ssmVal = ssm.StringParameter.valueForStringParameter.bind(null, stack)

  // Needs to include path to npmtoken
  const ssmResources = ['ordersapi', 'common'].map(p => `/cicd/${p}/*`)

  // Params using SSM values can also be read from local env, etc. and passed as plain string
  new BuildPipeline(stack, 'test-build-pipeline', {
    env: {
      region: 'us-west-2',
      account: 'abc123',
    },
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

  expect(stack).to(
    haveResource('AWS::CodePipeline::Pipeline', {
      Name: 'OrdersServiceMaster',
    })
  )
  // expect(pipe).to(
  //   matchTemplate(
  //     {
  //       Resources: {},
  //     },
  //     MatchStyle.EXACT
  //   )
  // )
})
