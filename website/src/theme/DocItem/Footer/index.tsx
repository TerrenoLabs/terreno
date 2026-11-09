import {useLocation} from "@docusaurus/router";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Footer from "@theme-original/DocItem/Footer";
import type React from "react";

const DOCS_FEEDBACK_BASE =
  "https://github.com/TerrenoLabs/terreno/discussions/new?category=docs-feedback";

const DocItemFooter: React.FC<React.ComponentProps<typeof Footer>> = (props) => {
  const {siteConfig} = useDocusaurusContext();
  const location = useLocation();
  const pageUrl = `${siteConfig.url}${location.pathname}`;
  const discussUrl = `${DOCS_FEEDBACK_BASE}&body=${encodeURIComponent(
    `Page: ${pageUrl}\n\nFeedback:\n`
  )}`;

  return (
    <div>
      <Footer {...props} />
      <p style={{marginTop: "1rem"}}>
        <a href={discussUrl}>Discuss this page</a>
      </p>
    </div>
  );
};

export default DocItemFooter;
