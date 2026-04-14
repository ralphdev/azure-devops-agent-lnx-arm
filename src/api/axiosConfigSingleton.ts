import { getAzureToken } from '../apis/secrects-manager';
import { USER_OWNER } from './constants';

export class AxiosConfig {
    private static instance: AxiosConfig;
    private authToken: string;

    private constructor(token: string) {
        const buffer = Buffer.from(USER_OWNER + ':' + token);
        const authToken = buffer.toString('base64');
        this.authToken = authToken;
    }

    static async getInstance(): Promise<AxiosConfig> {
        if (!AxiosConfig.instance) {
            AxiosConfig.instance = new AxiosConfig(await getAzureToken());
        }

        return AxiosConfig.instance;
    }

    public getConfig() {
        return {
                headers: {
                Authorization: `Basic ${this.authToken}`,
                contentType: "application/json",
            }
        }
    }
}
