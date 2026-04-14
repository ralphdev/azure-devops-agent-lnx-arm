import { SECRECT_ID } from '../util/constants'
import { SecretsManager } from 'aws-sdk';
import { REGION } from '../util/constants'

export async function getAzureToken(){
    const secrectManageClient = new SecretsManager({
        region: REGION,
        maxRetries: 3,
        retryDelayOptions: {base: 300}
    });

    let response = await secrectManageClient.getSecretValue({ SecretId: SECRECT_ID }).promise().catch(()=>{
        throw new Error(`Error when obtaining Azure PAT ${SECRECT_ID}`)
    });
    let secrect = JSON.parse(response.SecretString!)
    return secrect.token
}
