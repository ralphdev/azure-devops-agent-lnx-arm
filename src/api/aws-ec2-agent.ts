// aws-ec2-agent.ts
import * as AWS from 'aws-sdk';
import { AttributeValue, GetItemInput, ListAttributeValue, PutItemInput, PutItemInputAttributeMap } from 'aws-sdk/clients/dynamodb';
import { Instance, InstanceId, ReservationList, RunInstancesRequest } from 'aws-sdk/clients/ec2';
import { MONITOR_TABLE,REGION, AGENT_NAME, SUCCESS_MESSAGE, LUNCH_TEMPLATE_NAME,SUBNET_LIST_ID, POOL_ID, SG_ID} from '../utils/constants'
import * as azure from './azure-agents'

const localEndpoint = process.env.AWS_ENDPOINT_URL;

AWS.config.update({
    region: REGION,
    maxRetries: 3,
    retryDelayOptions: {base: 300}
});

export var ec2Client = new AWS.EC2({
    apiVersion: '2016-11-15',
    ...(localEndpoint && { endpoint: localEndpoint })
});

export var dynamoDbClient = new AWS.DynamoDB({
    ...(localEndpoint && { endpoint: localEndpoint })
});

export const createEC2Instance = async () => {

    let subnetlist:string[] = SUBNET_LIST_ID.split(',')
    let subnetId = subnetlist[Math.floor(Math.random()*subnetlist.length)]

    let instanceParams:RunInstancesRequest = {
        MaxCount: 1,
        MinCount: 1,
        LaunchTemplate: { LaunchTemplateName: LUNCH_TEMPLATE_NAME},
        NetworkInterfaces: [
            {
                AssociatePublicIpAddress: true,
                DeleteOnTermination: true,
                Description: "Agent Interface",
                DeviceIndex: 0,
                Groups: [ SG_ID ],
                SubnetId: subnetId
            }
        ]
    };

    await ec2Client.runInstances(instanceParams).promise();
}

export const getEC2Instance = async () => {

    let instancePromise = await ec2Client.describeInstances().promise();

    let instanceData = instancePromise.$response.data
    let reservations: ReservationList = []
    if(instanceData != undefined){
        reservations = instanceData.Reservations!
    }

    let agentInstances:Instance[] = [];
    for(let i=0; i < reservations.length; i++){
        let instances = reservations[i].Instances;
        if(instances != undefined && instances.length>0){
            for(let j=0; j< instances.length; j++){
                let tagsList = instances[j].Tags!;
                let stateName = instances[j].State!.Name!;
                if(tagsList != undefined && tagsList.length > 0 && stateName != undefined ){
                    if(tagsList.find(tag => (tag.Value?.includes(AGENT_NAME) && tag.Key?.includes('Name'))) &&
                    tagsList.find(tag => (tag.Value?.includes(POOL_ID) && tag.Key?.includes('PoolId'))) &&
                    (stateName.includes('running') || stateName.includes('pending'))) {
                        agentInstances.push(instances[j]);
                    }
                }
            }
        }
    }

    return agentInstances;
}


export const disableExpiredEc2Agents = async (expiredAgents:any[], instances:Instance[]) =>{

    let ec2ToDelete:InstanceId[] = [];

    for(let i=0; i < expiredAgents.length; i++){
        let expiredAgent =  expiredAgents[i]
        if(instances != undefined && instances.length>0){
            for(let j=0; j< instances.length; j++){
                let instanceId = instances[j].InstanceId;
                if (instanceId?.includes(expiredAgent.name)){
                    ec2ToDelete.push(instanceId);
                    break;
                }
            }
        }
    }

    if(ec2ToDelete.length > 0){
        await ec2Client.terminateInstances({ InstanceIds: ec2ToDelete }).promise();
        console.log(`${SUCCESS_MESSAGE} Delete Expired EC2 Agents in AWS ` + JSON.stringify(ec2ToDelete));
    }
}

const rowJobs:string = 'LnxArmJobs'

var paramaRquest:GetItemInput = {
    Key: {
        'conditions': { S: rowJobs}
    },
    TableName: MONITOR_TABLE
}

export const readRequestedJobs = async () => {

    let response = await dynamoDbClient.getItem(paramaRquest).promise();
    let item = response.Item;
    let jobs: string[] = []

    if(item !=undefined){
        let jobRequest = item.jobsRequested.L
        if(jobRequest != undefined){
            if(jobRequest!.length > 0){
                for(let i = 0; i < jobRequest!.length; i++){
                    let jobId = jobRequest[i].S
                    if( jobId != undefined){
                        jobs.push(jobId)
                    }
                }
            }
        }
    }
    return jobs;
}

export const addRequetedJobs = async (newJobId:string, jobsRequested:string[]) => {

    let value:AttributeValue = {S: newJobId}; //Nuevo Job a Agregar

    let listValues:ListAttributeValue = []

    if(jobsRequested.length >0 ){
        for(let i=0; i<jobsRequested.length; i++){
            listValues.push({S: jobsRequested[i]})
        }
    }
    listValues.push(value)

    let attribute:PutItemInputAttributeMap = {
        "conditions": {S:rowJobs},
        "jobsRequested": {L:listValues}
    }

    let item: PutItemInput = {
       TableName: MONITOR_TABLE,
       Item : attribute
    }

    await dynamoDbClient.putItem(item).promise()
}

export const cleanRequetedJobs = async () => {

    let listValues:ListAttributeValue = []

    let attribute:PutItemInputAttributeMap = {
        "conditions": {S:rowJobs},
        "jobsRequested": {L:listValues}
    }

    let item: PutItemInput = {
       TableName: MONITOR_TABLE,
       Item : attribute
    }

    await dynamoDbClient.putItem(item).promise()
}

export const getEC2InstanceNotConnAzure = async (agents:any[], tiempoDeExpiracionSegundos:number) => {
    let tiempoExpiracionMinutos = tiempoDeExpiracionSegundos/60
    let instancePromise = await ec2Client.describeInstances().promise();

    let instanceData = instancePromise.$response.data
    let reservations: ReservationList = []
    if(instanceData != undefined){
        reservations = instanceData.Reservations!
    }
    let agentInstances:Instance[] = [];
    for(let i=0; i < reservations.length; i++){
        let instances = reservations[i].Instances;
        if(instances != undefined && instances.length>0){
            for(let j=0; j< instances.length; j++){
                let tagsList = instances[j].Tags!;
                let stateName = instances[j].State!.Name!;
                let launchHour:Date = instances[j].UsageOperationUpdateTime!;
                let instanceId = instances[j].InstanceId
                let minutesFromLuched = azure.getDifferenceInMinutes(launchHour, new Date());
                if(tagsList != undefined && tagsList.length > 0 && stateName != undefined){
                    if( tagsList.find(tag => (tag.Value?.includes(AGENT_NAME) && tag.Key?.includes('Name'))) &&
                        tagsList.find(tag => (tag.Value?.includes(POOL_ID) && tag.Key?.includes('PoolId'))) &&
                        stateName.includes('running') && minutesFromLuched>tiempoExpiracionMinutos){
                        if(agents.length>0){
                            let agentConnected = agents.find(agent => agent.name.includes(instanceId))
                            if(!agentConnected){
                                agentInstances.push(instances[j]);
                            }else if(agentConnected.status=="offline" ){
                                agentInstances.push(instances[j]);
                            }
                        }else{
                            agentInstances.push(instances[j]);
                        }
                    }
                }
            }
        }
    }

    return agentInstances;
}

export const deleteEc2Instances = async (instances:Instance[]) =>{

    let ec2ToDelete:InstanceId[] = [];

        if(instances != undefined && instances.length>0){
            for(let j=0; j< instances.length; j++){
                let instanceId = instances[j].InstanceId;
                if(instanceId != undefined){
                    ec2ToDelete.push(instanceId);
                }
            }
        }

    if(ec2ToDelete.length > 0){
        await ec2Client.terminateInstances({ InstanceIds: ec2ToDelete }).promise();
        console.log(`${SUCCESS_MESSAGE} Delete EC2 Instances in AWS ` + JSON.stringify(ec2ToDelete));
    }
}

