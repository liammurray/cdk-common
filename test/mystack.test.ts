import { expect as cdkExpect, haveResource } from '@aws-cdk/assert'
import { SynthUtils } from '@aws-cdk/assert'
import * as cdk from '@aws-cdk/core'
import { BuildPipeline, makeBaseProps } from '../src/buildPipeline'

test('create pipeline', () => {
  const stack = new cdk.Stack(undefined, 'MyStack', {
    env: {
      region: 'us-west-2',
      account: '1234',
    },
  })

  const pipelineOpts = makeBaseProps(stack, 'UrlShortener', 'master')
  new BuildPipeline(stack, 'test-build-pipeline', {
    ...pipelineOpts,
    repo: 'ssm:/cicd/ordersapi/github/repo',
  })

  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot()

  cdkExpect(stack).to(
    haveResource('AWS::CodePipeline::Pipeline', {
      Name: 'UrlShortenerMaster',
    })
  )
})
