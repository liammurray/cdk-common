import * as ssm from '@aws-cdk/aws-ssm'
import * as cdk from '@aws-cdk/core'

interface LooseObject {
  [key: string]: any
}

export function resolveSsm(scope: cdk.Construct, props: LooseObject): void {
  const ssmVal = ssm.StringParameter.valueForStringParameter.bind(null, scope)

  // Expand "ssm:" entries. This is deferred because they are validated up front.
  const SSM_SCHEME = 'ssm:'
  for (const [key, val] of Object.entries(props)) {
    if (typeof val == 'string' && val.startsWith(SSM_SCHEME)) {
      props[key] = ssmVal(val.slice(SSM_SCHEME.length))
    }
  }
}
