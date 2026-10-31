---
title: Generate images in the AI chat
area: ai
audience: user
platforms: [web, ios, android]
questions:
  - How do I ask the AI assistant to make an image?
  - What does "Generating image…" mean?
  - What does "Used skill" mean in the chat?
  - Why did I get "Image limit reached for this turn"?
  - Will my generated images still be there later?
screens:
  - "example-frontend/app/(tabs)/ai.tsx"
added: gpt-skills-and-default-prompt
---

# Generate images in the AI chat

## What it does

The AI assistant can make an image from your description and show it in the chat. It can
also follow a skill, such as your team's poster style, while it makes the image.

## How to use it

1. Open the **AI** tab.
2. Describe the image you want, such as `Make a poster for a bake sale`. To use a skill,
   start with a slash and the skill's name, such as `/house-style a poster for a bake sale`.
3. Tap send.
4. When the assistant loads a skill, the chat shows a row that reads **Used skill** and the
   skill's name.
5. While the image is being made, a row reads **Generating image…**. When it is ready, the
   row reads **Generated image** and the image appears in the assistant's reply.

Tap a row to see the details the assistant sent. Generated images stay in the conversation:
open it again from your chat history and the image is still there.

If an image cannot be made, the row reads **Image not generated** and the reason shows in
red under it, such as "Image limit reached for this turn". Send a new message to try again.

## Intended use

Each reply can make a limited number of images, 4 unless your organization changed it. Ask
for more in a new message. Image generation is only available when your organization has
turned it on and you pick a model that can use tools.
Do not describe real people's health information in image requests: your description is
sent to the image service.
