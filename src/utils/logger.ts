import pino from 'pino';

const logger = pino({ level: 'info' }, process.stdout);

export default logger;
