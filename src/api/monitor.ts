import { AxiosConfig } from  './axiosConfigSingleton'
import { AZURE_URL, POOL_ID, MAX_EC2_INSTANCES , DELETE_AGENT_INTERVAL, CLEANUP_EC2_INTERVAL, SUCCESS_MESSAGE, FAILED_MESSAGE, MAX_EC2_MESSAGE} from '../utils/constants'
import * as AWS from './aws-ec2-agent'
import * as azureAgent from './azure-agents';
import axios from 'axios';



const getJobs = async () => {
    const axiosInstance = AxiosConfig.getInstance()
    let path = `${AZURE_URL}/_apis/distributedtask/pools/${POOL_ID}/jobrequests`;
    let config = (await axiosInstance).getConfig();

    let jobResponse = await axios.get(path, config) .catch(async () =>{
        await waitFor(2000);
        return await axios.get(path, config).catch(async () =>{
            await waitFor(3000);
            return await axios.get(path, config).catch(async (error) =>{ throw error})
        })
    });

    return jobResponse.data.value;
}

const getPendingJobs = async () => {
    let jobs:[] = await getJobs();
    let pendingJobs:any[] = []

    for (let i=0; i< jobs.length; i++){
        let job:any = jobs[i]
        if(!job.assignTime) {
            pendingJobs.push(job);
        }
    }
    return pendingJobs;
}

export const generateAgents = async () => {
        //Create Agent Process
        try {
            const pendingJobs = await getPendingJobs();

            if(pendingJobs.length > 0){
                console.log(pendingJobs)
                for(let i=0; i < pendingJobs.length; i++){

                    let requestedJobs = await AWS.readRequestedJobs();
                    let job = pendingJobs[i];
                    let jobId = job.requestId.toString();

                    if(!requestedJobs.includes(jobId)){

                        let readyAgents = await azureAgent.getAvailableAgents();
                        let currentEc2instances = await AWS.getEC2Instance();

                        if(!(readyAgents.length > 0)){
                            if(currentEc2instances.length<=MAX_EC2_INSTANCES){
                                await AWS.createEC2Instance();
                                console.log(`${SUCCESS_MESSAGE} EC2 Agent Requested for job: ${job.requestId}`);
                                await AWS.addRequetedJobs(jobId, requestedJobs)
                                console.log(`${SUCCESS_MESSAGE} JobId ${job.requestId} Added to cache`);
                            }else{
                                console.log(`${MAX_EC2_MESSAGE} Job ${job.requestId} must wait for agent to be available`);
                            }
                        }else{
                            console.log(`${SUCCESS_MESSAGE} Not lucnh Agent for Job ${job.requestId}, check Job Capabilities`);
                        }
                    }
                }
            }else{
                await AWS.cleanRequetedJobs();
            }
        } catch (error) {
            throw Error(`${FAILED_MESSAGE} Agent EC2 Creation Failed ${JSON.stringify(error)}`)
        }
}

export const terminateAgents = async () => {
        //Delete Agent Expired
        try {
            let agents = await azureAgent.getAgents(true, true, true);
            let expiredAgents = await azureAgent.getExpiredAgents(agents, DELETE_AGENT_INTERVAL);
            await azureAgent.updateDummyCapabilities(agents);
            if(expiredAgents.length > 0){
                await azureAgent.deleteExpiredAgents(expiredAgents);
                let currentEc2instances = await AWS.getEC2Instance();
                await AWS.disableExpiredEc2Agents(expiredAgents, currentEc2instances);
            }


        } catch (error) {
            throw Error(`${FAILED_MESSAGE} Delete Agent Expired Failed`)
        }
}

export const cleanUpAgents = async () => {
    //Cleanup Offline or Non Connected EC2
    try {
        let agents = await azureAgent.getAgents(false, false, false);
        let ec2InstanceNotConnected = await AWS.getEC2InstanceNotConnAzure(agents, CLEANUP_EC2_INTERVAL)
        if(ec2InstanceNotConnected.length > 0){
            await AWS.deleteEc2Instances(ec2InstanceNotConnected)
        }
    } catch (error) {
        throw Error(`${FAILED_MESSAGE} EC2 Cleanup Failed`);
    }
}


export const waitFor = async (timeInMilliseconds:number) =>{
    await new Promise(f => setTimeout(f, timeInMilliseconds));
}
