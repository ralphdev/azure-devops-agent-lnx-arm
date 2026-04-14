// handler.ts
import * as monitor from './apis/monitor';
import { Handler } from "aws-lambda";

const generateAgents:Handler = async () => {
    await monitor.generateAgents();
}

const terminateAgents:Handler = async () => {
    await monitor.terminateAgents();
}

const cleanUpAgents:Handler = async () => {
    await monitor.cleanUpAgents();
}

export { generateAgents, terminateAgents , cleanUpAgents};

// dummy.ts
/* import * as dummyAgent from './apis/dummyAgent';

const dummy = async () => {
    await dummyAgent.createDummy();
}

dummy(); */

