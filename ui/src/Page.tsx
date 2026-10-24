import {router} from "expo-router";
import React from "react";
import {SafeAreaView} from "react-native-safe-area-context";

import type {ActionSheet} from "./ActionSheet";
import {Box} from "./Box";
import {Button} from "./Button";
import type {PageProps} from "./Common";
import {ErrorBoundary} from "./ErrorBoundary";
import {Heading} from "./Heading";
import {IconButton} from "./IconButton";
import {Spinner} from "./Spinner";
import {Text} from "./Text";

export class Page extends React.Component<PageProps, {}> {
  actionSheetRef: React.RefObject<ActionSheet | null> = React.createRef();

  renderHeader() {
    if (!this.props.title && !this.props.backButton) {
      return null;
    }
    return (
      <Box direction="row" display="flex" position="relative" width="100%">
        {this.props.backButton && (
          <Box
            alignItems="center"
            display="block"
            justifyContent="center"
            paddingX={4}
            paddingY={3}
            position="relative"
            zIndex={1}
          >
            <IconButton
              accessibilityHint="Navigate back"
              accessibilityLabel="Back"
              iconName="chevron-left"
              onClick={() => {
                if (this.props.onBack) {
                  this.props.onBack();
                  return;
                }
                router.back();
              }}
            />
          </Box>
        )}
        {this.props.closeButton && (
          <Box alignItems="center" display="block" justifyContent="center" paddingY={3}>
            <IconButton
              accessibilityHint="Close page"
              accessibilityLabel=""
              iconName="xmark"
              onClick={() => router.back()}
            />
          </Box>
        )}
        {Boolean(this.props.title) && (
          <Box
            dangerouslySetInlineStyle={{__style: {pointerEvents: "box-none"}}}
            direction="column"
            display="flex"
            flex="grow"
            justifyContent="center"
          >
            <Heading align="center">{this.props.title}</Heading>
          </Box>
        )}
        {this.props.rightButton && (
          <Box alignItems="center" display="block" justifyContent="center" paddingY={3}>
            <Button
              onClick={() => this.props.rightButtonOnClick?.()}
              text={this.props.rightButton}
              variant="muted"
            />
          </Box>
        )}
      </Box>
    );
  }

  renderContent() {
    // Without a loadingComponent, Page keeps its centered spinner and optional loadingText.
    const spinner = (
      <Box
        alignItems="center"
        direction="column"
        display="flex"
        flex="grow"
        justifyContent="center"
        marginTop={8}
      >
        <Spinner />
        {Boolean(this.props.loadingText) && (
          <Box marginTop={2}>
            <Text color="secondaryDark">{this.props.loadingText}</Text>
          </Box>
        )}
      </Box>
    );
    if (!this.props.loading) {
      return this.props.children;
    }
    // Both paths render through a loading Box so the page announces loadingLabel and is busy.
    return (
      <Box
        direction="column"
        flex="grow"
        loading
        loadingAnimation={this.props.loadingAnimation}
        loadingComponent={this.props.loadingComponent ?? spinner}
        loadingLabel={this.props.loadingLabel}
        testID={this.props.testID ? `${this.props.testID}-loading` : undefined}
        width="100%"
      />
    );
  }

  renderBody() {
    return (
      <>
        <Box
          alignSelf="center"
          avoidKeyboard
          color={this.props.color || "base"}
          direction={this.props.direction || "column"}
          display={this.props.display || "flex"}
          flex="grow"
          height="100%"
          keyboardOffset={this.props.keyboardOffset}
          maxWidth={this.props.maxWidth || 800}
          padding={this.props.padding !== undefined ? this.props.padding : 2}
          scroll={this.props.scroll === undefined ? true : this.props.scroll}
          testID={this.props.testID}
          width="100%"
        >
          {this.renderHeader()}
          {this.renderContent()}
        </Box>
        {Boolean(this.props.footer) && (
          <Box
            alignSelf="center"
            color={
              this.props.color === "transparent" ? "base" : (this.props.color ?? "neutralLight")
            }
            direction={this.props.direction || "column"}
            display={this.props.display || "flex"}
            flex="shrink"
            marginBottom={8}
            maxWidth={this.props.maxWidth || 800}
            paddingX={this.props.padding !== undefined ? this.props.padding : 6}
            paddingY={this.props.padding !== undefined ? this.props.padding : 2}
            width="100%"
          >
            {this.props.footer}
          </Box>
        )}
      </>
    );
  }

  render() {
    return (
      <ErrorBoundary onError={this.props.onError}>
        {this.props.safeArea ? (
          <SafeAreaView edges={["top", "bottom"]} style={{flex: 1}}>
            {this.renderBody()}
          </SafeAreaView>
        ) : (
          this.renderBody()
        )}
      </ErrorBoundary>
    );
  }
}
