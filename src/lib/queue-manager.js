import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const QUEUE_FILE_PATH = path.join(process.cwd(), 'post_queue.json');

function readQueue() {
    try {
        if (!fs.existsSync(QUEUE_FILE_PATH)) {
            fs.writeFileSync(QUEUE_FILE_PATH, JSON.stringify([], null, 2));
            return [];
        }
        const queueData = fs.readFileSync(QUEUE_FILE_PATH, 'utf8');
        return JSON.parse(queueData);
    } catch (error) {
        console.error('[QUEUE-ERROR] Could not read or parse queue file:', error);
        return []; // Return an empty array on error to prevent crashes
    }
}

function writeQueue(queue) {
    try {
        fs.writeFileSync(QUEUE_FILE_PATH, JSON.stringify(queue, null, 2));
    } catch (error) {
        console.error('[QUEUE-ERROR] Could not write to queue file:', error);
    }
}

export function getPendingJobCount() {
    const queue = readQueue();
    return queue.filter(j => j.status === 'pending').length;
}

export function getAnyJobCount() {
    const queue = readQueue();
    return queue.length;
}

export function addJob(jobDetails) {
    const queue = readQueue();
    const newJob = {
        id: uuidv4(),
        status: 'pending',
        createdAt: new Date().toISOString(),
        ...jobDetails
    };
    queue.push(newJob);
    writeQueue(queue);
    console.log(`[APP-SUCCESS] New job ${newJob.id} added to the queue.`);
    return newJob;
}

export function clearQueue() {
    writeQueue([]);
    console.log('[APP-SUCCESS] Job queue has been cleared.');
}
