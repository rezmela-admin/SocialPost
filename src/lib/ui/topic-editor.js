import { editor, select } from '@inquirer/prompts';

export async function editTopic(initialTopic, options = {}) {
    let currentTopic = initialTopic;
    let isEditing = true;

    if (options.startInEditMode) {
        const newTopic = await editor({
            message: 'Edit the topic:',
            default: currentTopic,
            validate: input => input.trim().length > 0
        });
        // If the user cancels the editor, the prompt throws, which is handled by the main app loop.
        // If they submit, we update the topic and proceed to the approval loop.
        currentTopic = newTopic;
    }

    while (isEditing) {
        const firstLine = String(currentTopic).split('\n')[0];
        const preview = firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine;
        const choice = await select({
            message: `Current Topic: "${preview}"`,
            choices: [
                { name: 'Approve', value: 'approve' },
                { name: 'Edit', value: 'edit' },
                { name: 'Cancel', value: 'cancel' },
            ],
        });

        switch (choice) {
            case 'approve':
                isEditing = false;
                return currentTopic;
            case 'edit':
                currentTopic = await editor({ 
                    message: 'Edit the topic:', 
                    default: currentTopic,
                    validate: input => input.trim().length > 0
                });
                break;
            case 'cancel':
                isEditing = false;
                return null;
        }
    }
}
