import type React from "react";
import {Component, createRef} from "react";
import {
  Animated,
  Dimensions,
  type EmitterSubscription,
  FlatList,
  findNodeHandle,
  Keyboard,
  type KeyboardEvent,
  type LayoutChangeEvent,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  TextInput,
  UIManager,
  View,
  type ViewInstance,
} from "react-native";

import type {ActionSheetProps} from "./Common";

export const styles = StyleSheet.create({
  container: {
    alignSelf: "center",
    backgroundColor: "white",
    width: "100%",
  },
  indicator: {
    alignSelf: "center",
    backgroundColor: "#f0f0f0",
    borderRadius: 100,
    height: 6,
    marginVertical: 5,
    width: 45,
  },
  parentContainer: {
    alignItems: "center",
    height: "100%",
    justifyContent: "center",
    width: "100%",
  },
  safearea: {
    left: 999999,
    position: "absolute",
    top: 999999,
  },
  scrollView: {
    backgroundColor: "transparent",
    height: "100%",
    width: "100%",
  },
});

/** FlatList's underlying scroll view, reachable only through internal fields. */
interface FlatListWithScrollRef {
  _listRef: {_scrollRef: {scrollTo: (options: {animated: boolean; x: number; y: number}) => void}};
}

export const getDeviceHeight = (statusBarTranslucent: boolean | undefined): number => {
  const height = Dimensions.get("window").height;

  if (Platform.OS === "android" && !statusBarTranslucent) {
    return StatusBar.currentHeight ? height - StatusBar.currentHeight : height;
  }

  return height;
};

export const getElevation = (elevation?: number) => {
  if (!elevation) {
    return {};
  }
  return {
    boxShadow: `${0.3 * elevation}px ${0.5 * elevation}px ${0.7 * elevation}px rgba(0, 0, 0, 0.2)`,
    elevation,
  };
};

export const SUPPORTED_ORIENTATIONS: (
  | "portrait"
  | "portrait-upside-down"
  | "landscape"
  | "landscape-left"
  | "landscape-right"
)[] = ["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"];

export const waitAsync = (ms: number): Promise<null> =>
  new Promise((resolve) => {
    setTimeout(() => {
      resolve(null);
    }, ms);
  });

const safeAreaInnerHeight = 0;
const dummyData = ["dummy"];
let safeAreaPaddingTop = Platform.OS === "android" ? StatusBar.currentHeight || 0 : 0;
let calculatedDeviceHeight = Dimensions.get("window").height;

export const resetActionSheetDeviceHeightCacheForTests = (): void => {
  calculatedDeviceHeight = Dimensions.get("window").height;
};

type State = {
  modalVisible: boolean;
  scrollable: boolean;
  layoutHasCalled: boolean;
  keyboard: boolean;
  deviceHeight: number;
  deviceWidth: number;
  portrait: boolean;
  safeAreaInnerHeight: number;
  paddingTop: number;
};

const defaultProps = {
  animated: true,
  bottomOffset: 0,
  bounciness: 8,
  closable: true,
  closeAnimationDuration: 300,
  closeOnPressBack: true,
  closeOnTouchBackdrop: true,
  defaultOverlayOpacity: 0.3,
  delayActionSheetDrawTime: 0,
  drawUnderStatusBar: true,
  elevation: 5,
  extraScroll: 0,
  gestureEnabled: false,
  indicatorColor: "#f0f0f0",
  initialOffsetFromBottom: 1,
  keyboardMode: "padding",
  openAnimationSpeed: 12,
  overlayColor: "black",
  springOffset: 100,
  statusBarTranslucent: true,
};

type Props = Partial<typeof defaultProps> & ActionSheetProps;

export class ActionSheet extends Component<Props, State, unknown> {
  static defaultProps = defaultProps;

  actionSheetHeight = 0;

  keyboardDidShowListener: EmitterSubscription | null = null;

  keyboardDidHideListener: EmitterSubscription | null = null;

  prevScroll = 0;

  timeout: ReturnType<typeof setTimeout> | null = null;

  offsetY = 0;

  currentOffsetFromBottom = 0;

  scrollAnimationEndValue = 0;

  hasBounced = false;

  layoutHasCalled = false;

  isClosing = false;

  isRecoiling = false;

  isReachedTop = false;

  deviceLayoutCalled = false;

  scrollViewRef: React.RefObject<FlatList<string> | null>;

  safeAreaViewRef: React.RefObject<ViewInstance | null>;

  transformValue: Animated.Value;

  opacityValue: Animated.Value;

  borderRadius: Animated.Value;

  underlayTranslateY: Animated.Value;

  underlayScale: Animated.Value;

  indicatorTranslateY: Animated.Value;

  constructor(props: ActionSheetProps) {
    super(props);
    this.state = {
      deviceHeight: calculatedDeviceHeight || getDeviceHeight(this.props.statusBarTranslucent),
      deviceWidth: Dimensions.get("window").width,
      keyboard: false,
      layoutHasCalled: false,
      modalVisible: false,
      paddingTop: safeAreaPaddingTop,
      portrait: true,
      safeAreaInnerHeight,
      scrollable: false,
    };

    this.actionSheetHeight = 0;
    this.prevScroll = 0;
    this.scrollAnimationEndValue = 0;
    this.hasBounced = false;
    this.scrollViewRef = createRef();
    this.layoutHasCalled = false;
    this.isClosing = false;
    this.isRecoiling = false;
    this.offsetY = 0;
    this.safeAreaViewRef = createRef();
    this.transformValue = new Animated.Value(0);
    this.opacityValue = new Animated.Value(0);
    this.borderRadius = new Animated.Value(10);
    this.currentOffsetFromBottom = this.props.initialOffsetFromBottom as number;
    this.underlayTranslateY = new Animated.Value(100);
    this.underlayScale = new Animated.Value(1);
    this.indicatorTranslateY = new Animated.Value(-this.state.paddingTop | 0);
    this.isReachedTop = false;
    this.deviceLayoutCalled = false;
    this.timeout = null;
  }

  /**
   * Snap ActionSheet to Offset
   */

  snapToOffset = (offset: number) => {
    const correction = this.state.deviceHeight * 0.15;
    const extraScroll = this.props.extraScroll || 0;
    const scrollOffset = this.props.gestureEnabled
      ? offset + correction + extraScroll
      : offset + correction + extraScroll;
    this.currentOffsetFromBottom = offset / this.actionSheetHeight;
    this._scrollTo(scrollOffset);
    this.updateActionSheetPosition(scrollOffset);
  };

  // Open the ActionSheet
  show = () => {
    this.setModalVisible(true);
  };

  // Close the ActionSheet
  hide = () => {
    this.setModalVisible(false);
  };

  /**
   * Open/Close the ActionSheet
   */
  setModalVisible = (visible: boolean) => {
    let modalVisible = this.state.modalVisible;
    if (visible !== undefined) {
      if (modalVisible === visible) {
        return;
      }
      modalVisible = !visible;
    }

    if (!modalVisible) {
      this.setState({
        modalVisible: true,
        scrollable: this.props.gestureEnabled || false,
      });
    } else {
      this._hideModal();
    }
  };

  _hideAnimation() {
    const {
      animated,
      closeAnimationDuration,
      bottomOffset,
      initialOffsetFromBottom,
      extraScroll,
      closable,
    } = this.props;

    Animated.parallel([
      Animated.timing(this.opacityValue, {
        duration: animated ? closeAnimationDuration : 1,
        toValue: closable ? 0 : 1,
        useNativeDriver: true,
      }),
      Animated.timing(this.transformValue, {
        duration: animated ? closeAnimationDuration : 1,
        toValue: closable ? this.actionSheetHeight * 2 : 0,
        useNativeDriver: true,
      }),
    ]).start();

    void waitAsync((closeAnimationDuration as number) / 1.5).then(() => {
      if (!closable) {
        if (bottomOffset && bottomOffset > 0) {
          this.snapToOffset(bottomOffset);
        } else {
          this._scrollTo(
            ((this.actionSheetHeight * (initialOffsetFromBottom || 0)) as number) +
              this.state.deviceHeight * 0.1 +
              (extraScroll ?? 0),
            true
          );
          this.currentOffsetFromBottom = initialOffsetFromBottom as number;
        }

        this.isClosing = false;
      } else {
        this._scrollTo(0, false);
        this.currentOffsetFromBottom = initialOffsetFromBottom as number;
        this.setState(
          {
            modalVisible: !closable,
          },
          () => {
            this.isClosing = false;
            this.isReachedTop = false;
            this.props.onPositionChanged?.(false);
            this.indicatorTranslateY.setValue(-this.state.paddingTop);
            this.layoutHasCalled = false;
            this.deviceLayoutCalled = false;
            this.props.onClose?.();
          }
        );
      }
    });
  }

  _hideModal = () => {
    if (this.isClosing) return;
    this.isClosing = true;
    this._hideAnimation();
  };

  measure = async (): Promise<number> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const ref = this.safeAreaViewRef.current;
        if (ref?.measureInWindow) {
          ref.measureInWindow((_x: number, _y: number, _width: number, height: number) => {
            safeAreaPaddingTop = height;
            resolve(height === 0 ? 20 : height);
          });
        } else {
          resolve(20);
        }
      }, 100);
    });
  };

  _showModal = async (event: LayoutChangeEvent) => {
    const {gestureEnabled, delayActionSheetDraw, delayActionSheetDrawTime} = this.props;

    if (!event?.nativeEvent) return;
    const height = event.nativeEvent.layout.height;
    if (this.layoutHasCalled) {
      this.actionSheetHeight = height;
      this._returnToPrevScrollPosition(height);
      return;
    } else {
      this.layoutHasCalled = true;
      this.actionSheetHeight = height;
      const scrollOffset = this.getInitialScrollPosition();
      this.isRecoiling = false;
      if (Platform.OS === "ios") {
        await waitAsync(delayActionSheetDrawTime as number);
      } else {
        if (delayActionSheetDraw) {
          await waitAsync(delayActionSheetDrawTime as number);
        }
      }
      this._scrollTo(scrollOffset, false);
      this.prevScroll = scrollOffset;
      if (Platform.OS === "ios") {
        await waitAsync(delayActionSheetDrawTime ?? 0 / 2);
      } else {
        if (delayActionSheetDraw) {
          await waitAsync(delayActionSheetDrawTime ?? 0 / 2);
        }
      }
      this._openAnimation(scrollOffset);
      this.underlayScale.setValue(1);
      this.underlayTranslateY.setValue(100);
      if (!gestureEnabled) {
        this.props.onPositionChanged?.(true);
      }
      this.updateActionSheetPosition(scrollOffset);
    }
  };

  _openAnimation = (scrollOffset: number) => {
    const {bounciness, bounceOnOpen, animated, openAnimationSpeed} = this.props;

    if (animated) {
      this.transformValue.setValue(scrollOffset);
      Animated.parallel([
        Animated.spring(this.transformValue, {
          bounciness: bounceOnOpen ? bounciness : 1,
          speed: openAnimationSpeed,
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.timing(this.opacityValue, {
          duration: 150,
          toValue: 1,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      this.opacityValue.setValue(1);
    }
  };

  _onScrollBegin = async () => {};

  _onScrollBeginDrag = async (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    this.prevScroll = event.nativeEvent.contentOffset.y;
  };

  _applyHeightLimiter() {
    if (this.actionSheetHeight > this.state.deviceHeight) {
      this.actionSheetHeight =
        this.actionSheetHeight - (this.actionSheetHeight - this.state.deviceHeight);
    }
  }

  _onScrollEnd = async (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const {springOffset, extraScroll} = this.props;
    const verticalOffset = event.nativeEvent.contentOffset.y;

    const correction = this.state.deviceHeight * 0.15;
    if (this.isRecoiling) return;

    if (this.prevScroll < verticalOffset) {
      if (verticalOffset - this.prevScroll > (springOffset ?? 0) * 0.75) {
        this.isRecoiling = true;

        this._applyHeightLimiter();
        this.currentOffsetFromBottom =
          this.currentOffsetFromBottom < (this.props.initialOffsetFromBottom ?? 0)
            ? (this.props.initialOffsetFromBottom as number)
            : 1;
        const scrollOffset =
          this.actionSheetHeight * this.currentOffsetFromBottom + correction + (extraScroll ?? 0);

        this._scrollTo(scrollOffset);
        await waitAsync(300);
        this.isRecoiling = false;
        this.props.onPositionChanged?.(true);
      } else {
        this._returnToPrevScrollPosition(this.actionSheetHeight);
      }
    } else {
      if (this.prevScroll - verticalOffset > (springOffset ?? 0)) {
        this._hideModal();
      } else {
        if (this.isRecoiling) {
          return;
        }

        this.isRecoiling = true;
        this._returnToPrevScrollPosition(this.actionSheetHeight);
        await waitAsync(300);
        this.isRecoiling = false;
      }
    }
  };

  updateActionSheetPosition(scrollPosition: number) {
    if (this.actionSheetHeight >= this.state.deviceHeight - 1) {
      const correction = this.state.deviceHeight * 0.15;
      const distanceFromTop = this.actionSheetHeight + correction - scrollPosition;
      if (distanceFromTop < safeAreaPaddingTop) {
        if (!this.props.drawUnderStatusBar) return;
        this.indicatorTranslateY.setValue(0);
      } else {
        this.indicatorTranslateY.setValue(-safeAreaPaddingTop);
      }
    }
  }

  _returnToPrevScrollPosition(height: number) {
    const correction = this.state.deviceHeight * 0.15;
    const scrollOffset =
      height * this.currentOffsetFromBottom + correction + (this.props.extraScroll ?? 0);

    this.updateActionSheetPosition(scrollOffset);
    this._scrollTo(scrollOffset);
  }

  _scrollTo = (y: number, animated = true) => {
    this.scrollAnimationEndValue = y;
    this.prevScroll = y;
    const list = this.scrollViewRef.current as FlatListWithScrollRef | null;
    list?._listRef._scrollRef.scrollTo({
      animated,
      x: 0,
      y: this.scrollAnimationEndValue,
    });
  };

  _onTouchMove = () => {
    if (this.props.closeOnTouchBackdrop) {
      this._hideModal();
    }
    this.setState({
      scrollable: false,
    });
  };

  _onTouchStart = () => {
    if (this.props.closeOnTouchBackdrop) {
      this._hideModal();
    }
    this.setState({
      scrollable: false,
    });
  };

  _onTouchEnd = () => {
    this._returnToPrevScrollPosition(this.actionSheetHeight);
    if (this.props.gestureEnabled) {
      this.setState({
        scrollable: true,
      });
    }
  };

  _onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    this.offsetY = event.nativeEvent.contentOffset.y;

    const correction = this.state.deviceHeight * 0.15;
    const distanceFromTop = this.actionSheetHeight + correction - this.offsetY;

    if (this.actionSheetHeight < this.offsetY) {
      if (!this.isReachedTop) {
        this.isReachedTop = true;
        this.props.onPositionChanged?.(true);
      }
    } else {
      if (this.isReachedTop) {
        this.isReachedTop = false;
        this.props.onPositionChanged?.(false);
      }
    }

    if (this.actionSheetHeight >= this.state.deviceHeight - 1) {
      if (distanceFromTop < safeAreaPaddingTop) {
        if (!this.props.drawUnderStatusBar) return;

        this.indicatorTranslateY.setValue(
          -this.state.paddingTop + (safeAreaPaddingTop - distanceFromTop)
        );
      } else {
        this.indicatorTranslateY.setValue(-safeAreaPaddingTop);
      }
    }
  };

  _onRequestClose = () => {
    if (this.props.closeOnPressBack) this._hideModal();
  };

  _onTouchBackdrop = () => {
    if (this.props.closeOnTouchBackdrop) {
      this._hideModal();
    }
  };

  componentDidMount() {
    this.keyboardDidShowListener = Keyboard.addListener(
      Platform.OS === "android" ? "keyboardDidShow" : "keyboardWillShow",
      this._onKeyboardShow
    );

    this.keyboardDidHideListener = Keyboard.addListener(
      Platform.OS === "android" ? "keyboardDidHide" : "keyboardWillHide",
      this._onKeyboardHide
    );
  }

  _onKeyboardShow = (event: KeyboardEvent) => {
    this.setState({
      keyboard: true,
    });

    const keyboardHeight = event.endCoordinates.height;
    const {height: windowHeight} = Dimensions.get("window");

    const textInputState = TextInput.State as {
      currentlyFocusedField?: () => number | null | undefined;
      currentlyFocusedInput?: () => Parameters<typeof findNodeHandle>[0] | null | undefined;
    };
    const currentlyFocusedInput = textInputState.currentlyFocusedInput?.();
    const currentlyFocusedField =
      currentlyFocusedInput != null
        ? findNodeHandle(currentlyFocusedInput)
        : textInputState.currentlyFocusedField?.();

    if (!currentlyFocusedField) {
      return;
    }

    UIManager.measure(
      currentlyFocusedField,
      (_originX, _originY, _width, height, _pageX, pageY) => {
        const fieldHeight = height;
        const gap = windowHeight - keyboardHeight - (pageY + fieldHeight);
        if (gap >= 0) {
          return;
        }
        const toValue = this.props.keyboardMode === "position" ? -(keyboardHeight + 15) : gap - 10;

        Animated.timing(this.transformValue, {
          duration: 250,
          toValue,
          useNativeDriver: true,
        }).start();
      }
    );
  };

  /**
   * Attach this to any child ScrollView Component's onScrollEndDrag,
   * onMomentumScrollEnd,onScrollAnimationEnd callbacks to handle the ActionSheet
   * closing and bouncing back properly.
   */

  handleChildScrollEnd = async () => {
    if (this.offsetY > this.prevScroll) return;
    if (this.prevScroll - (this.props.springOffset ?? 0) > this.offsetY) {
      const scrollOffset = this.getInitialScrollPosition();
      if (this.offsetY > scrollOffset - 100) {
        this.isRecoiling = true;
        this._scrollTo(scrollOffset);
        this.currentOffsetFromBottom = this.props.initialOffsetFromBottom ?? 0;
        this.prevScroll = scrollOffset;
        setTimeout(() => {
          this.isRecoiling = false;
        }, 500);
      } else {
        this._hideModal();
      }
    } else {
      this.isRecoiling = true;
      this._scrollTo(this.prevScroll, true);
      setTimeout(() => {
        this.isRecoiling = false;
      }, 500);
    }
  };

  _onKeyboardHide = () => {
    this.setState({
      keyboard: false,
    });
    this.opacityValue.setValue(1);
    Animated.timing(this.transformValue, {
      duration: 100,
      toValue: 0,
      useNativeDriver: true,
    }).start();
  };

  componentWillUnmount() {
    this.keyboardDidShowListener?.remove();
    this.keyboardDidHideListener?.remove();
  }

  _onDeviceLayout = async (_event: LayoutChangeEvent) => {
    const event = {..._event};

    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    this.timeout = setTimeout(async () => {
      let safeMarginFromTop = 0;
      const measuredPadding =
        Platform.OS === "ios" ? await this.measure() : StatusBar.currentHeight;

      if (!this.props.drawUnderStatusBar) {
        if (Platform.OS === "android" && !this.props.statusBarTranslucent) return;
        safeMarginFromTop = measuredPadding ?? 0;
        this.indicatorTranslateY.setValue(-(measuredPadding as number));
      } else {
        this.updateActionSheetPosition(this.offsetY);
      }
      const height = event.nativeEvent.layout.height - safeMarginFromTop;
      const width = Dimensions.get("window").width;
      if (
        height?.toFixed(0) === calculatedDeviceHeight?.toFixed(0) &&
        width?.toFixed(0) === this.state.deviceWidth?.toFixed(0) &&
        this.deviceLayoutCalled
      )
        return;
      this.deviceLayoutCalled = true;
      calculatedDeviceHeight = height;
      this.setState({
        deviceHeight: height,
        deviceWidth: width,
        paddingTop: measuredPadding ?? 0,
        portrait: height > width,
      });
    }, 1);
  };

  getInitialScrollPosition() {
    this._applyHeightLimiter();
    const correction = this.state.deviceHeight * 0.15;
    const scrollPosition = this.props.gestureEnabled
      ? this.actionSheetHeight * (this.props.initialOffsetFromBottom ?? 0) +
        correction +
        (this.props.extraScroll ?? 0)
      : this.actionSheetHeight + correction + (this.props.extraScroll ?? 0);
    this.currentOffsetFromBottom = this.props.initialOffsetFromBottom ?? 0;
    this.updateActionSheetPosition(scrollPosition);

    return scrollPosition;
  }

  _keyExtractor = (item: string) => item;

  render() {
    const {scrollable, modalVisible, keyboard} = this.state;
    const {
      onOpen,
      overlayColor,
      gestureEnabled,
      elevation,
      indicatorColor,
      defaultOverlayOpacity,
      children,
      containerStyle,
      CustomHeaderComponent,
      headerAlwaysVisible,
      keyboardShouldPersistTaps,
      statusBarTranslucent,
    } = this.props;
    const persistTaps =
      keyboardShouldPersistTaps === true
        ? "always"
        : keyboardShouldPersistTaps === false
          ? "never"
          : keyboardShouldPersistTaps;

    return (
      <Modal
        animationType="none"
        onRequestClose={this._onRequestClose}
        // testID={testID}
        onShow={onOpen}
        statusBarTranslucent={statusBarTranslucent}
        supportedOrientations={SUPPORTED_ORIENTATIONS}
        transparent
        visible={modalVisible}
      >
        <Animated.View
          onLayout={this._onDeviceLayout}
          style={[
            styles.parentContainer,
            {
              opacity: this.opacityValue,
              width: this.state.deviceWidth,
            },
          ]}
        >
          <SafeAreaView ref={this.safeAreaViewRef} style={styles.safearea}>
            <View />
          </SafeAreaView>
          <FlatList
            bounces={false}
            contentContainerStyle={{
              width: this.state.deviceWidth,
            }}
            data={dummyData}
            keyboardShouldPersistTaps={persistTaps}
            keyExtractor={this._keyExtractor}
            onMomentumScrollBegin={this._onScrollBegin}
            onMomentumScrollEnd={this._onScrollEnd}
            onScroll={this._onScroll}
            onScrollBeginDrag={this._onScrollBeginDrag}
            onTouchEnd={this._onTouchEnd}
            ref={this.scrollViewRef}
            renderItem={() => (
              <View
                style={{
                  width: "100%",
                }}
              >
                <Animated.View
                  onTouchEnd={this._onTouchBackdrop}
                  onTouchMove={this._onTouchBackdrop}
                  onTouchStart={this._onTouchBackdrop}
                  style={{
                    backgroundColor: overlayColor,
                    height: "100%",
                    opacity: defaultOverlayOpacity,
                    position: "absolute",
                    width: "100%",
                    zIndex: 1,
                  }}
                />
                <View
                  onTouchEnd={this._onTouchEnd}
                  onTouchMove={this._onTouchMove}
                  onTouchStart={this._onTouchStart}
                  style={{
                    height: this.state.deviceHeight * 1.15,
                    width: "100%",
                    zIndex: 10,
                  }}
                >
                  <Pressable
                    aria-role="button"
                    onLongPress={this._onTouchBackdrop}
                    onPress={this._onTouchBackdrop}
                    style={{
                      height: this.state.deviceHeight * 1.15,
                      width: "100%",
                    }}
                  />
                </View>

                <Animated.View
                  onLayout={this._showModal}
                  style={[
                    styles.container,
                    {
                      borderRadius: 10,
                    },
                    containerStyle,
                    {
                      ...getElevation(elevation),
                      maxHeight: this.state.deviceHeight,
                      opacity: this.opacityValue,
                      transform: [
                        {
                          translateY: this.transformValue,
                        },
                      ],
                      zIndex: 11,
                    },
                  ]}
                >
                  <Animated.View
                    style={{
                      marginTop: this.state.paddingTop,
                      maxHeight: this.state.deviceHeight,
                      transform: [
                        {
                          translateY: this.indicatorTranslateY,
                        },
                      ],
                    }}
                  >
                    {gestureEnabled || headerAlwaysVisible ? (
                      CustomHeaderComponent ? (
                        CustomHeaderComponent
                      ) : (
                        <Animated.View
                          style={[styles.indicator, {backgroundColor: indicatorColor}]}
                        />
                      )
                    ) : null}

                    {children}
                  </Animated.View>
                </Animated.View>
              </View>
            )}
            scrollEnabled={scrollable && !keyboard}
            scrollEventThrottle={5}
            scrollsToTop={false}
            showsVerticalScrollIndicator={false}
            style={[
              styles.scrollView,
              {
                width: this.state.deviceWidth,
              },
            ]}
          />
        </Animated.View>
      </Modal>
    );
  }
}
