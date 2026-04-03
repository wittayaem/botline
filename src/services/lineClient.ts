import * as line from '@line/bot-sdk';

const config: line.ClientConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
};

export const client = new line.messagingApi.MessagingApiClient(config);
export const blobClient = new line.messagingApi.MessagingApiBlobClient(config);
