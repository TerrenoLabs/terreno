---
title: Set the AI assistant's default prompt and skills for everyone
area: admin
audience: admin
platforms: [web]
questions:
  - How do I set a default system prompt for every AI chat?
  - How do I set a style for every generated image?
  - How do I clear the default system prompt?
  - How do I add a skill for every user?
  - How do I turn off or delete a skill for everyone?
screens:
  - "example-frontend/app/admin/configuration.tsx"
  - "example-frontend/app/admin/[model]/index.tsx"
  - "example-frontend/app/admin/[model]/create.tsx"
  - "example-frontend/app/admin/[model]/[id].tsx"
added: gpt-skills-and-default-prompt
---

# Set the AI assistant's default prompt and skills for everyone

## What it does

Admins set instructions that the AI assistant follows in every user's chat, a style added
to every image the assistant generates, and skills that every user can use. Changes apply
to the next message each user sends.

## How to use it

1. In the admin panel sidebar, open **Configuration**.
2. In the **Ai** section, type the instructions every chat should follow into **System
   Prompt**, such as "Answer as Terreno Bot".
3. To steer every generated image, type a style into **Image Style Prompt**, such as "Flat
   pastel illustration".
4. Tap **Save Configuration**. "Configuration saved" appears, and the text is still there
   after you reload the page.

To stop using a default prompt, delete all the text in **System Prompt** or **Image Style
Prompt** and tap **Save Configuration**. The assistant goes back to its usual behavior.

To add a skill for every user:

1. In the admin panel sidebar, under **AI**, open **Skills**.
2. Tap **Create**.
3. Enter a **Name** in lowercase letters, digits, and hyphens, such as `team-poster`.
4. Enter a **Description** that says when the skill should be used.
5. Enter the **Instructions** the assistant should follow.
6. Tap **Create**. Every user now sees the skill on their **Skills** screen, marked **For
   everyone**.

To change a skill, tap it in the **Skills** list, edit it, and tap **Save**. Turn off
**Enabled** to hide it from the assistant without deleting it, or tap **Delete** to remove
it.

To add a skill with reference files, such as a sample image, use **Upload skill** with
**Install for everyone** turned on, on your own **Skills** screen in the app.

## Intended use

Use these settings for guidance every user's chats should share, such as your
organization's tone or image style. Whatever you type reaches every user's chat at once,
and earlier versions are not kept, so keep a copy of text you may want back. Users cannot
see or change the system prompt. They can see skills marked **For everyone** but cannot
edit or delete them. Do not put personal or health information in these settings.

## Related

- [Teach the AI assistant a skill](../ai/skills.md)
- [Generate images in the AI chat](../ai/generate-images.md)
