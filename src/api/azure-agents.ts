import { AZURE_URL, POOL_ID , AGENT_NAME, DUMMY_AGENT_NAME,SUCCESS_MESSAGE} from '../utils/constants'
import axios from 'axios';
import * as job from'./monitor';
import { AxiosConfig } from  './axiosConfigSingleton'

const axiosInstance = AxiosConfig.getInstance()

export const getAgents = async (assignedRequest:boolean, lastCompletedRequest:boolean, capabilities:boolean) => {

    let path = `${AZURE_URL}/_apis/distributedtask/pools/${POOL_ID}/agents?includeAssignedRequest=${assignedRequest}&includeLastCompletedRequest=${lastCompletedRequest}&includeCapabilities=${capabilities}&api-version=6.0`;

    let config = (await axiosInstance).getConfig();

    let agent = await axios.get(path, config).catch(async (error) =>{
        await job.waitFor(2000);
        return axios.get(path,config).catch(async (error) =>{
            await job.waitFor(3000);
            return axios.get(path,config).catch(async (error) =>{ throw error})
        })
    });
    return agent.data.value;
}


export const getAvailableAgents = async () =>{
    let assignRequest = true;
    let lastCompletedRequest = false;
    let capabilities = false;

    let agents:any[] = await getAgents(assignRequest, lastCompletedRequest, capabilities);
    let enableAgents: any[] = [];

    if (agents != undefined && agents.length>0){
        for(let i=0; i< agents.length; i++){
            let agent = agents[i];
            let enabled:boolean = agent.enabled;
            let status:string = agent.status;
            let assignRequest = agent.assignedRequest

            if(enabled == true && status.toLowerCase().includes('online') && assignRequest == undefined){
                enableAgents.push(agent);
            }
        }
    }

    return enableAgents;
}

export const getDummyAgent = async () => {
    let assignRequest = false;
    let lastCompletedRequest = false;
    let capabilities = false;

    let agents = await getAgents(assignRequest, lastCompletedRequest, capabilities);
    let dummyAgent: any[] = [];

    for(let i=0; i< agents.length; i++){
        let agent = agents[i];
        let name:string = agent.name;

        if(name.toLowerCase().includes(DUMMY_AGENT_NAME)){
            dummyAgent.push(agent);
            break;
        }
    }
    return dummyAgent;
}


export const createDummyAgent = async () => {
    let path = `${AZURE_URL}/_apis/distributedtask/pools/${POOL_ID}/agents?api-version=6.0`;
    let config = (await axiosInstance).getConfig();
    let agent = await axios.post(path, dummyAgent,config).catch(async () =>{
        await job.waitFor(2000);
        return axios.post(path, dummyAgent,config).catch(async () =>{
            await job.waitFor(3000);
            return axios.post(path, dummyAgent,config).catch(async (error) =>{ throw error})
        })
    });
    return agent.data;
}

const updateAgent = async (request: any)=> {
    let path = `${AZURE_URL}/_apis/distributedtask/pools/${POOL_ID}/agents/${request.id}?api-version=6.0`
    let config = (await axiosInstance).getConfig();
    await axios.patch(path,request,config).catch(async () =>{
        await job.waitFor(2000);
        return axios.patch(path,request,config).catch(async () =>{
            await job.waitFor(3000);
            return axios.patch(path,request,config).catch(async (error) =>{ throw error})
        })
    });

}

const replaceAgent = async (request: any)=> {
    let path = `${AZURE_URL}/_apis/distributedtask/pools/${POOL_ID}/agents/${request.id}?api-version=6.0`
    let config = (await axiosInstance).getConfig();
    await axios.put(path, request, config).catch(async () =>{
        await job.waitFor(2000);
        return axios.put(path, request, config).catch(async () =>{
            await job.waitFor(3000);
            return axios.put(path, request, config).catch(async (error) =>{ throw error})
        })
    });
}


const deleteAgent = async (disableRequest: any)=> {
    let path = `${AZURE_URL}/_apis/distributedtask/pools/${POOL_ID}/agents/${disableRequest.id}?api-version=6.0`;
    let config = (await axiosInstance).getConfig();
    await axios.delete(path, config).catch(async () =>{
        await job.waitFor(2000);
        return axios.delete(path, config).catch(async () =>{
            await job.waitFor(3000);
            return axios.delete(path, config).catch(async (error) =>{ throw error})
        })
    });
}

export const disableDummyAgent = async (agentId: number) => {
    let disableRequest = {
        "id": agentId,
        "maxParallelism": 1,
        "name": DUMMY_AGENT_NAME,
        "enabled": false,
        "version": "2.202.0",
        "status": "offline"
    }
    await updateAgent(disableRequest);
}

const dummyAgent = {
    "maxParallelism": 1,
    "name": DUMMY_AGENT_NAME,
    "version": "2.202.0",
    "status": "offline",
}

export const updateDummyCapabilities = async (agents:any) =>{

    if (agents != undefined && agents.length>0){
        let lastAgent = agents[agents.length-1];
        if(!lastAgent.name.includes(DUMMY_AGENT_NAME)){
            let dummyAgents = await getDummyAgent();
            let dummyAgent = dummyAgents[0];
            dummyAgent.systemCapabilities = lastAgent.systemCapabilities;
            await replaceAgent(dummyAgent);
            console.log(`${SUCCESS_MESSAGE} Dummy Agent updated`);
        }
    }
}

export const getExpiredAgents = async (agents:any[], tiempoDeExpiracionSegundos:number) => {
    let tiempoDeExpiracionMinutos=tiempoDeExpiracionSegundos/60;

    let expiredAgents: any[] = [];
    if (agents != undefined && agents.length>0){
        for(let i=0; i< agents.length; i++){
            let agent = agents[i];
            let enabled:boolean = agent.enabled;
            let status:string = agent.status;
            let assignRequest = agent.assignedRequest;
            let pendingUpdate = agent.pendingUpdate;
            let lastCompletedRequest = agent.lastCompletedRequest;
            let createdOn = agent.createdOn;
            let name = agent.name;

            if(!name.includes(DUMMY_AGENT_NAME) &&
                !name.includes("static") &&
                enabled == true &&
                status.toLowerCase().includes('online') &&
                !name.includes("linux-agent") &&
                assignRequest == undefined  &&
                pendingUpdate == undefined){
                if(lastCompletedRequest!=undefined){
                    let finishTime = lastCompletedRequest.finishTime
                    if(finishTime != undefined ){
                        if(getDifferenceInMinutes(new Date(finishTime), new Date()) > tiempoDeExpiracionMinutos){
                            expiredAgents.push(agent);
                        }
                    }
                }else{
                    if(createdOn != undefined){
                        if(getDifferenceInMinutes(new Date(createdOn), new Date()) > tiempoDeExpiracionMinutos){
                            expiredAgents.push(agent);
                        }
                    }
                }
            }

        }
    }

    return expiredAgents;

}

export function getDifferenceInMinutes(date1:Date, date2:Date) {
    const diffInMs = Math.abs(date1.getTime() - date2.getTime());
    return diffInMs / (1000 * 60);
  }


  export const deleteExpiredAgents = async (expiredAgents:any[]) => {
    for(let i=0; i < expiredAgents.length ; i++){
        let agent = expiredAgents[i];
        await deleteAgent(agent);
    }
    console.log(`${SUCCESS_MESSAGE} Disable Expired Agents in Azure ` + JSON.stringify(expiredAgents));
  }
