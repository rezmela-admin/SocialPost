import { editor, select } from '@inquirer/prompts';

export async function editTopic(initialTopic) {
    let currentTopic = initialTopic;
    let isEditing = true;

    while (isEditing) {
        const choice = await select({
            message: `Current Topic: "${currentTopic}"`,
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
