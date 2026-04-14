// handler.ts
import * as monitor from './api/monitor';
import { Handler, APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { WEBHOOK_SECRET } from './utils/constants';

const generateAgents: Handler = async () => {
    await monitor.generateAgents();
}

const terminateAgents: Handler = async () => {
    await monitor.terminateAgents();
}

const cleanUpAgents: Handler = async () => {
    await monitor.cleanUpAgents();
}

const webhookTrigger: Handler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event) => {
    // Validar el shared secret enviado como query param ?secret=xxx
    const incomingSecret = event.queryStringParameters?.secret || '';
    if (WEBHOOK_SECRET && incomingSecret !== WEBHOOK_SECRET) {
        console.log('=====> WEBHOOK: Unauthorized request - secret inválido');
        return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const eventType: string = body.eventType || 'unknown';
        const resourceId: string = body.resource?.id || body.resource?.run?.id || 'unknown';

        console.log(`=====> WEBHOOK: Evento recibido eventType=${eventType} resourceId=${resourceId}`);

        await monitor.generateAgents();

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Agent generation triggered', eventType, resourceId })
        };
    } catch (error) {
        console.log(`=====> WEBHOOK FAILED: ${JSON.stringify(error)}`);
        return { statusCode: 500, body: JSON.stringify({ message: 'Internal error triggering agents' }) };
    }
}

export { generateAgents, terminateAgents, cleanUpAgents, webhookTrigger };

// dummy.ts
/* import * as dummyAgent from './apis/dummyAgent';

const dummy = async () => {
    await dummyAgent.createDummy();
}

dummy(); */

