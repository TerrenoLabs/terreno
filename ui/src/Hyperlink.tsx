/**
 * @providesModule Hyperlink
 *
 * Forked from https://github.com/obipawan/react-native-hyperlink
 *
 *
 * MIT License
 *
 * Copyright (c) 2019 Pawan
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * */

/**
 * Hyperlink is used to wrap text that should be clickable.
 * It will automatically detect URLs and open them in the browser. For example,
 * this is great for wrapping text in a chat app so any link in a chat message is clickable.
 * This is different than <Link> which is meant for specifically linking to a URL.
 */

import * as mdurl from "mdurl";
import React from "react";
import {Linking, Platform, type StyleProp, Text, type TextStyle, View} from "react-native";

import type {HyperlinkProps, LinkifyItLike, LinkifyMatch} from "./Common";

const linkifyLib: LinkifyItLike = require("linkify-it")();

const {OS} = Platform;

// Leaving this as a class component because it was easier to handle the `parse(this)` in
// `render()`
class HyperlinkComponent extends React.Component<HyperlinkProps> {
  isTextNested = (component: React.ReactElement) => {
    if (!React.isValidElement(component)) throw new Error("Invalid component");
    const componentType = (component.type as {displayName?: string} | undefined) ?? {};
    const {displayName} = componentType;
    if (displayName !== "Text") throw new Error("Not a Text component");
    return typeof (component.props as {children?: unknown}).children !== "string";
  };

  linkify = (component: React.ReactElement<{children: string; style?: StyleProp<TextStyle>}>) => {
    const linkifyIt = this.props.linkify || linkifyLib;

    if (!linkifyIt.pretest(component.props.children) || !linkifyIt.test(component.props.children))
      return component;

    const elements: React.ReactNode[] = [];
    let _lastIndex = 0;

    const {key: _key, ref: _ref, ...componentProps} = component.props as Record<string, unknown>;

    try {
      linkifyIt
        .match(component.props.children)
        ?.forEach(({index, lastIndex, text, url}: LinkifyMatch) => {
          const nonLinkedText = component.props.children.substring(_lastIndex, index);
          nonLinkedText && elements.push(nonLinkedText);
          _lastIndex = lastIndex;
          if (this.props.linkText)
            text =
              typeof this.props.linkText === "function"
                ? this.props.linkText(url)
                : this.props.linkText;

          const clickHandlerProps: {onPress?: () => void; onLongPress?: () => void} = {};
          if (OS !== "web") {
            if (this.props.onLongPress) {
              clickHandlerProps.onLongPress = () => this.props.onLongPress?.(url, text);
            }
          }
          if (this.props.onPress) {
            // The HyperlinkProps onPress signature is (url) => void per Common.ts, but this forked
            // component invokes it with both url and text. Cast to avoid arity mismatch.
            const onPressFn = this.props.onPress as (url: string, text: string) => void;
            clickHandlerProps.onPress = () => onPressFn(url, text);
          }

          let injected: Record<string, unknown> = {};
          if (this.props.injectViewProps) {
            injected = this.props.injectViewProps(url);
          }

          elements.push(
            <Text
              {...componentProps}
              {...clickHandlerProps}
              key={url + index}
              style={[component.props.style, this.props.linkStyle]}
              {...injected}
            >
              {text}
            </Text>
          );
        });
      elements.push(
        component.props.children.substring(_lastIndex, component.props.children.length)
      );
      return React.cloneElement(component, componentProps, elements);
    } catch (_error) {
      return component;
    }
  };

  parse = (component: React.ReactElement): React.ReactElement => {
    const props =
      (component?.props as {children?: React.ReactNode; style?: StyleProp<TextStyle>}) ?? {};
    const {children} = props;
    if (!children) return component;

    const {key: _key, ref: _ref, ...componentProps} = component.props as Record<string, unknown>;

    const linkifyIt = this.props.linkify || linkifyLib;

    return React.cloneElement(
      component,
      componentProps,
      React.Children.map(children, (child) => {
        const childType = (child as React.ReactElement | null)?.type as
          | {displayName?: string}
          | undefined;
        const displayName = childType?.displayName;
        if (typeof child === "string" && linkifyIt.pretest(child))
          return this.linkify(
            <Text {...componentProps} style={props.style}>
              {child}
            </Text>
          );
        if (displayName === "Text" && !this.isTextNested(child as React.ReactElement))
          return this.linkify(
            child as React.ReactElement<{children: string; style?: StyleProp<TextStyle>}>
          );
        return this.parse(child as React.ReactElement);
      })
    );
  };

  render() {
    const {...viewProps} = this.props;
    delete viewProps.onPress;
    delete viewProps.linkDefault;
    delete viewProps.onLongPress;
    delete viewProps.linkStyle;

    return (
      <View {...viewProps} style={this.props.style}>
        {!this.props.onPress && !this.props.onLongPress && !this.props.linkStyle
          ? this.props.children
          : (
              this.parse(this as unknown as React.ReactElement).props as {
                children?: React.ReactNode;
              }
            ).children}
      </View>
    );
  }
}

export const Hyperlink = (props: HyperlinkProps) => {
  const handleLink = (url: string) => {
    const urlObject = mdurl.parse(url);
    urlObject.protocol = urlObject.protocol?.toLowerCase() ?? "";
    const normalizedURL = mdurl.format(urlObject);

    void Linking.canOpenURL(normalizedURL).then((supported) => {
      if (supported) {
        return Linking.openURL(normalizedURL);
      }
      return undefined;
    });
  };

  const onPress = handleLink || props.onPress;
  if (props.linkDefault) return <HyperlinkComponent {...props} onPress={onPress} />;
  return <HyperlinkComponent {...props} />;
};
