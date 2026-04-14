import { SECRECT_ID, REGION } from '../utils/constants'
import { SecretsManager } from 'aws-sdk';

export async function getAzureToken(){
    const localEndpoint = process.env.AWS_ENDPOINT_URL;
    const secrectManageClient = new SecretsManager({
        region: REGION,
        maxRetries: 3,
        retryDelayOptions: {base: 300},
        ...(localEndpoint && { endpoint: localEndpoint })
    });

    let response = await secrectManageClient.getSecretValue({ SecretId: SECRECT_ID }).promise().catch(()=>{
        throw new Error(`Error when obtaining Azure PAT ${SECRECT_ID}`)
    });
    let secrect = JSON.parse(response.SecretString!)
    return secrect.token
}
