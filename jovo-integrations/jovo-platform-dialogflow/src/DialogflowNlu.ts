import * as _ from 'lodash';
import {
    Extensible,
    HandleRequest, Jovo, Platform
} from "jovo-core";
import {DialogflowRequest} from "./core/DialogflowRequest";
import {EnumRequestType, NLUData, ExtensibleConfig} from "jovo-core";
import {DialogflowResponse} from "./core/DialogflowResponse";
import {DialogflowRequestBuilder} from "./core/DialogflowRequestBuilder";
import {DialogflowResponseBuilder} from "./core/DialogflowResponseBuilder";

export interface DialogflowNluConfig extends ExtensibleConfig {
    sessionContextId?: string;
    platformClazz?: Jovo;
    platformRequestClazz?: any; // tslint:disable-line
    platformResponseClazz?: any; // tslint:disable-line
    platformId?: string;
}

class Dialogflow {
    jovo: Jovo;
    platform: string;
    $request: DialogflowRequest;
    $response: DialogflowResponse;

    constructor(jovo: Jovo) {
        this.jovo = jovo;
        this.$request = DialogflowRequest.fromJSON(jovo.$host.getRequestObject()) as DialogflowRequest;
        this.platform = this.$request.originalDetectIntentRequest.source;
        this.$response = new DialogflowResponse();
    }
}

export class DialogflowNlu extends Extensible {

    config: DialogflowNluConfig = {
        enabled: true,
        sessionContextId: 'session',

        plugin: {},
    };

    constructor(config?: DialogflowNluConfig) {
        super(config);

        if (config) {
            this.config = _.merge(this.config, config);
        }
    }

    install(platform: Extensible) {

        // @ts-ignore
        platform.requestBuilder = new DialogflowRequestBuilder();
        // @ts-ignore
        platform.requestBuilder.platform = 'google';
        // @ts-ignore
        platform.requestBuilder.platformRequestClazz = this.config.platformRequestClazz;
        // @ts-ignore
        platform.responseBuilder = new DialogflowResponseBuilder();


        platform.middleware('$init')!.use(this.init.bind(this));

        // // Register to Platform middleware
        platform.middleware('$request')!.use(this.request.bind(this));
        platform.middleware('$type')!.use(this.type.bind(this));
        platform.middleware('$nlu')!.use(this.nlu.bind(this));
        platform.middleware('$inputs')!.use(this.inputs.bind(this));

        platform.middleware('$output')!.use(this.output.bind(this));
        platform.middleware('$session')!.use(this.session.bind(this));

        platform.middleware('$response')!.use(this.response.bind(this));
        Object.assign(Jovo.prototype, {
            dialogflow() {
                return this.$plugins.DialogflowNlu.dialogflow;
            }
        });
    }
    uninstall(platform: Extensible) {

    }

    async init(handleRequest: HandleRequest) {
        const requestObject = handleRequest.host.getRequestObject();
        if (requestObject.queryResult &&
            requestObject.originalDetectIntentRequest &&
            requestObject.session) {

            handleRequest.jovo = new handleRequest.platformClazz(handleRequest.app, handleRequest.host);
            _.set(handleRequest.jovo.$plugins, 'DialogflowNlu.dialogflow', new Dialogflow(handleRequest.jovo));
        }
    }

    request(jovo: Jovo) {
        jovo.$originalRequest = _.get(jovo.$plugins.DialogflowNlu.dialogflow.$request, 'originalDetectIntentRequest.payload');
        jovo.$request = jovo.$plugins.DialogflowNlu.dialogflow.$request;
        (jovo.$request as DialogflowRequest).originalDetectIntentRequest.payload = this.config.platformRequestClazz.fromJSON(jovo.$originalRequest );
        // _.set(jovo.$request, 'originalDetectIntentRequest.payload', jovo.platformRequest.fromJSON(jovo.$originalRequest ));
    }

    type(jovo: Jovo) {
        if (_.get(jovo.$plugins.DialogflowNlu.dialogflow.$request, 'queryResult.intent')) {
            if (_.get(jovo.$plugins.DialogflowNlu.dialogflow.$request, 'queryResult.intent.displayName') === 'Default Welcome Intent') {
                jovo.$type = {
                    type: EnumRequestType.LAUNCH
                };
            } else if (_.get(jovo.$plugins.DialogflowNlu.dialogflow.$request, 'queryResult.intent.isFallback', false) === false) {

                if (_.get(jovo.$plugins.DialogflowNlu.dialogflow.$request, 'queryResult.intent.displayName') === 'Default Fallback Intent' &&
                    jovo.$type) {

                } else {
                    jovo.$type = {
                        type: EnumRequestType.INTENT
                    };
                }
            }
        }
    }

    nlu(jovo: Jovo) {
        const nluData: NLUData = {

        };
        if (jovo.$type.type === EnumRequestType.INTENT) {
            _.set(nluData, 'intent.name', _.get(jovo.$plugins.DialogflowNlu.dialogflow.$request, 'queryResult.intent.displayName'));
        }
        jovo.$nlu = nluData;
    }

    inputs(jovo: Jovo) {
        const params = _.get(jovo.$plugins.DialogflowNlu.dialogflow.$request, 'queryResult.parameters');
        jovo.$inputs = _.mapValues(params, (value, name) => {
            return {
                name,
                value,
                key: value, // Added for cross platform consistency
                id: value, // Added for cross platform consistency
            };
        });
    }

    async session(jovo: Jovo) {
        const dialogflowRequest = jovo.$plugins.DialogflowNlu.dialogflow.$request;

        const sessionId = _.get(dialogflowRequest, 'session');
        const sessionContext =_.get(dialogflowRequest, 'queryResult.outputContexts').find((context: any) => { // tslint:disable-line
            return context.name === `${sessionId}/contexts/${this.config.sessionContextId}`;
        });

        if (sessionContext) {
            jovo.$session.$data = sessionContext.parameters;

            for (const parameter of Object.keys(_.get(dialogflowRequest, 'queryResult.parameters'))) {
                delete jovo.$session.$data[parameter];
                delete jovo.$session.$data[parameter + '.original'];
            }
        }
        jovo.$requestSessionAttributes = JSON.parse(JSON.stringify(jovo.$session.$data));

    }

    output(jovo: Jovo) {
        const output = jovo.$output;
        const dialogflowResponse = jovo.$plugins.DialogflowNlu.dialogflow.$response;
        const dialogflowRequest = jovo.$plugins.DialogflowNlu.dialogflow.$request;
        const sessionId = _.get(dialogflowRequest, 'session');

        if (_.get(output, 'tell')) {
            _.set(dialogflowResponse, 'fulfillmentText', `<speak>${output.tell.speech}</speak>`);
        }
        if (_.get(output, 'ask')) {
            _.set(dialogflowResponse, 'fulfillmentText', `<speak>${output.ask.speech}</speak>`);
        }

        const outputContexts = _.get(dialogflowRequest, 'queryResult.outputContexts');
        const contextName = `${sessionId}/contexts/${this.config.sessionContextId}`;

        if (Object.keys(jovo.$session.$data).length > 0) {
            const sessionContext = outputContexts.find((context: any) => { // tslint:disable-line
                return context.name === contextName;
            });

            if (sessionContext) {
                outputContexts.forEach((context: any) => { // tslint:disable-line
                    if (context.name === contextName) {
                        context.parameters = jovo.$session.$data;
                    }
                });
            } else {
                outputContexts.push({
                    name: contextName,
                    lifespanCount: 1000,
                    parameters: jovo.$session.$data
                });
            }
        }
        _.set(dialogflowResponse, 'outputContexts', _.get(dialogflowRequest, 'queryResult.outputContexts'));
    }


    async response(jovo: Jovo) {
        (jovo.$plugins.DialogflowNlu.dialogflow.$response as DialogflowResponse).payload = {
            [this.config.platformId]: this.config.platformResponseClazz.fromJSON(jovo.$response )
        };
        // _.set(jovo.$plugins.DialogflowNlu.dialogflow.$response, `payload.${jovo.$plugins.DialogflowNlu.dialogflow.platform}`, jovo.$response);
        jovo.$response = jovo.$plugins.DialogflowNlu.dialogflow.$response;
    }

}