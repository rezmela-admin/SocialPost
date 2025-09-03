# Application Workflows

Here are the workflows available in the application:

## Generate and Queue Post (`generateAndQueuePost`)

This is the standard workflow for creating a single-image social media post. It takes a topic, generates a text summary and an image prompt using an AI text model, generates an image, and then queues the final post for scheduling. It includes an approval step for the user to review and accept the generated image before it's finalized.

## Generate and Queue Comic Strip (`generateAndQueueComicStrip`)

This workflow generates a multi-panel comic strip. It uses an AI text model to create a script with a summary and individual panel descriptions. It then generates an image for each panel, requiring user approval for each one. Finally, it composes the approved panels into a single comic strip image and queues it for posting.

## Generate Virtual Influencer Post (`generateVirtualInfluencerPost`)

This is a specialized two-phase workflow. In Phase 1, it generates an image of a character against a neutral background. In Phase 2, it uses an inpainting script (`edit_image.py`) to replace the neutral background with a new scene, effectively placing the character into a new environment. This workflow is designed for creating posts featuring a consistent "virtual influencer" character.