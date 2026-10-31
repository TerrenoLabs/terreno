---
title: Teach the AI assistant a skill
area: ai
audience: user
platforms: [web, ios, android]
questions:
  - How do I create a skill for the AI assistant?
  - How do I upload a SKILL.md or a skill zip?
  - How do I delete a skill?
  - What does "For everyone" mean on a skill?
  - How do I use a skill in a chat?
screens:
  - "example-frontend/app/settings/skills.tsx"
  - "example-frontend/app/(tabs)/ai.tsx"
  - "example-frontend/app/(tabs)/profile.tsx"
added: gpt-skills-and-default-prompt
---

# Teach the AI assistant a skill

## What it does

A skill is a saved set of instructions that teaches the AI assistant how to do one kind of
task, such as writing in your team's voice. **Skills** lists your own skills and the skills
an admin installed for everyone, marked **For everyone**.

## How to use it

1. Open **Skills**: on the **AI** tab, tap **Skills** at the top, or on **Profile**, tap
   **Skills**.
2. Tap **New skill**.
3. Enter a **Name** in lowercase letters, digits, and hyphens, such as `brand-voice`.
4. Enter a **Description** that says when the skill should be used.
5. Enter the **Instructions** the assistant should follow.
6. Tap **Save**. The skill appears in the list.

To add a skill from a file instead, tap **Upload skill** and pick a `SKILL.md` file or a
`.zip` package that holds a `SKILL.md` and its reference files, up to 10 MB. The file's
header sets the skill's name and description.

To delete one of your skills, tap the trash icon next to it, then tap **Delete**.

To use a skill in a chat, start your message on the **AI** tab with a slash and the skill's
name, such as `/brand-voice write a welcome email`. The assistant can also pick a skill on
its own when your request matches its description.

If saving or uploading fails, the reason shows in red under the form or the buttons. Fix
it, such as a name with spaces or capital letters, and try again.

Admins also see **Install for everyone**. Turn it on before tapping **Save** or **Upload
skill** to make the skill available to every user.

## Intended use

Use skills for instructions you would otherwise repeat in many chats. Your skills are
private to you. You cannot delete a skill marked **For everyone**; ask an admin. When an
admin installs a skill for everyone with the same name as one of yours, the assistant uses
theirs, and yours shows "Hidden by a skill for everyone".
