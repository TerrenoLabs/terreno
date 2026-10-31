# AI regression suite

Area: AI
Owner: unassigned
Last full run: never

Manual and automated regression cases for `@terreno/ai` features. Each row names the
automated test that covers it, or `manual` when only a person can check it.

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| AI-001 | A global style skill with a reference image steers a real Nano Banana image | Start example-backend with a Vertex project that allows `gemini-3-pro-image` and with file storage configured. As admin, upload `example-frontend/e2e/fixtures/team-poster.zip` (SKILL.md + a flat pastel reference PNG) with **Install for everyone** on. Sign in as test@example.com, open **AI**, and send "/team-poster a poster for a bake sale". | The chat shows "Used skill team-poster", then one generated image whose palette and style match the reference PNG. Reloading the page still shows the image. | web | manual | gpt-skills-and-default-prompt |

