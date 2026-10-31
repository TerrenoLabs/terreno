# AI regression cases

Manual and automated regression cases for `@terreno/ai` features. Each row names the
automated test that covers it, or `manual` when only a person can check it.

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| AI-new-1 | A global style skill with a reference image steers a real Nano Banana image | Start example-backend with a Vertex project that allows `gemini-3-pro-image` and with file storage configured. As admin, upload `example-frontend/e2e/fixtures/team-poster.zip` (SKILL.md + a flat pastel reference PNG) with **Install for everyone** on. Sign in as test@example.com, open **AI**, and send "/team-poster a poster for a bake sale". | The chat shows "Used skill team-poster", then one generated image whose palette and style match the reference PNG. Reloading the page still shows the image. | web | manual (the mocked flow is `example-frontend/e2e/ai-image-generation.spec.ts`) | gpt-skills-and-default-prompt |

## Verification status

- **AI-new-1** — not yet run. It needs Vertex credentials with access to
  `gemini-3-pro-image` and a GCS bucket, which the development sandbox does not have. Every
  automated test uses scripted models, so this is the only check that a real model accepts
  reference images. Run it before release and record the date and result here.
