import { select, Separator } from '@inquirer/prompts';
import chalk from 'chalk';

export async function menuManager(menu) {
    const menuStack = [menu];
    let keepGoing = true;

    while (keepGoing && menuStack.length > 0) {
        let currentMenu = menuStack[menuStack.length - 1];
        
        // If the menu is a function, call it to get the dynamic menu object
        if (typeof currentMenu === 'function') {
            currentMenu = currentMenu();
        }

        const choices = [...currentMenu.choices];

        if (menuStack.length > 1) {
            choices.push(new Separator());
            choices.push({ name: 'Back', value: 'back' });
        }
        
        choices.push(new Separator());
        choices.push({ name: 'Quit', value: 'quit' });

        console.log(chalk.yellow(`
--- ${currentMenu.title} ---`));
        const action = await select({ message: currentMenu.message, choices });

        if (action === 'back') {
            menuStack.pop();
        } else if (action === 'quit') {
            keepGoing = false;
        } else {
            const selectedChoice = currentMenu.choices.find(c => c.value === action);
            if (selectedChoice && selectedChoice.submenu) {
                menuStack.push(selectedChoice.submenu);
            } else if (selectedChoice && selectedChoice.action) {
                await selectedChoice.action();
                if (selectedChoice.popAfterAction) {
                    menuStack.pop();
                }
            }
        }
    }
    console.log("[APP-INFO] Shutting down.");
}