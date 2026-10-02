/**
 * Vendored from react-native-toast-notifications v3.4.0
 * https://github.com/arnnis/react-native-toast-notifications
 *
 * MIT License
 *
 * Copyright (c) 2020 Alireza Rezania
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
 */

import React, {
  createContext,
  type FC,
  forwardRef,
  type ReactElement,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  PanResponder,
  type PanResponderGestureState,
  type PanResponderInstance,
  Platform,
  SafeAreaView,
  type ScaledSize,
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
  TouchableWithoutFeedback,
  View,
  type ViewStyle,
} from "react-native";
import type {ToastProps as TerrenoToastPayload} from "./Common";
import {createWebPortal} from "./createWebPortal";
import {resolveDocumentBodyPortalTarget} from "./resolveDocumentBodyPortalTarget";

// ============================================================================
// useDimensions hook
// ============================================================================

const useDimensions = () => {
  const [dimensions, setDimensions] = useState(Dimensions.get("window"));

  const onChange = useCallback(({window}: {window: ScaledSize}) => {
    setDimensions(window);
  }, []);

  useEffect(() => {
    const subscription = Dimensions.addEventListener("change", onChange);

    return () => {
      subscription.remove();
    };
  }, [onChange]);

  return dimensions;
};

// ============================================================================
// Toast Options and Props
// ============================================================================

export interface ToastOptions {
  /**
   * Id is optional, you may provide an id only if you want to update toast later using toast.update()
   */
  id?: string;

  /**
   * Customize toast icon
   */
  icon?: ReactElement;

  /**
   * Toast types, You can implement your custom types with JSX using renderType method on ToastContainer.
   */
  type?: "normal" | "success" | "danger" | "warning" | string;

  /**
   * In ms, How long toast will stay before it go away
   */
  duration?: number;

  /**
   * Customize when toast should be placed
   */
  placement?: "top" | "bottom" | "center";

  /**
   * Customize style of toast
   */
  style?: StyleProp<ViewStyle>;

  /**
   * Customize style of toast text
   */
  textStyle?: StyleProp<TextStyle>;

  /**
   * Customize how fast toast will show and hide
   */
  animationDuration?: number;

  /**
   * Customize how toast is animated when added or removed
   */
  animationType?: "slide-in" | "zoom-in";

  /**
   * Customize success type icon
   */
  successIcon?: ReactElement;

  /**
   * Customize danger type icon
   */
  dangerIcon?: ReactElement;

  /**
   * Customize warning type icon
   */
  warningIcon?: ReactElement;

  /**
   * Customize success type color. changes toast background color
   */
  successColor?: string;

  /**
   * Customize danger type color. changes toast background color
   */
  dangerColor?: string;

  /**
   * Customize warning type color. changes toast background color
   */
  warningColor?: string;

  /**
   * Customize normal type color. changes toast background color
   */
  normalColor?: string;

  /**
   * Register event for when toast is pressed. If you're using a custom toast you have to pass this to a Touchable.
   */
  onPress?(id: string): void;

  /**
   * Execute event after toast is closed
   */
  onClose?(): void;

  /**
   * Payload forwarded to {@link Toast} via TerrenoProvider's renderToast.
   * Extra keys are allowed for custom renderToast implementations.
   */
  data?: Partial<TerrenoToastPayload> & Record<string, unknown>;

  swipeEnabled?: boolean;
}

export interface ToastProps extends ToastOptions {
  id: string;
  onDestroy(): void;
  message: string | ReactElement;
  open: boolean;
  renderToast?(toast: ToastProps): ReactElement;
  renderType?: {[type: string]: (toast: ToastProps) => ReactElement};
  onHide(): void;
}

// ============================================================================
// Toast Component
// ============================================================================

const ToastItem: FC<ToastProps> = (props) => {
  let {
    id,
    onDestroy,
    icon,
    type = "normal",
    message,
    duration = 5000,
    style,
    textStyle,
    animationDuration = 250,
    animationType = "slide-in",
    successIcon,
    dangerIcon,
    warningIcon,
    successColor,
    dangerColor,
    warningColor,
    normalColor,
    placement,
    swipeEnabled,
    onPress,
  } = props;

  const containerRef = useRef<View>(null);
  const [animation] = useState(new Animated.Value(0));
  const panResponderRef = useRef<PanResponderInstance | undefined>(undefined);
  const panResponderAnimRef = useRef<Animated.ValueXY | undefined>(undefined);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dims = useDimensions();

  const handleClose = useCallback(() => {
    Animated.timing(animation, {
      duration: animationDuration,
      toValue: 0,
      useNativeDriver: Platform.OS !== "web",
    }).start(() => onDestroy());
  }, [animation, animationDuration, onDestroy]);

  useEffect(() => {
    Animated.timing(animation, {
      duration: animationDuration,
      toValue: 1,
      useNativeDriver: Platform.OS !== "web",
    }).start();
    if (duration !== 0 && typeof duration === "number") {
      closeTimeoutRef.current = setTimeout(() => {
        handleClose();
      }, duration);
    }

    return () => {
      closeTimeoutRef.current && clearTimeout(closeTimeoutRef.current);
    };
  }, [duration, animation, animationDuration, handleClose]);

  // Handles hide & hideAll
  useEffect(() => {
    if (!props.open) {
      // Unregister close timeout
      closeTimeoutRef.current && clearTimeout(closeTimeoutRef.current);

      // Close animation them remove from stack.
      handleClose();
    }
  }, [
    props.open, // Close animation them remove from stack.
    handleClose,
  ]);

  const panReleaseToLeft = (gestureState: PanResponderGestureState) => {
    Animated.timing(getPanResponderAnim(), {
      duration: 250,
      toValue: {x: (-dims.width / 10) * 9, y: gestureState.dy},
      useNativeDriver: Platform.OS !== "web",
    }).start(() => onDestroy());
  };

  const panReleaseToRight = (gestureState: PanResponderGestureState) => {
    Animated.timing(getPanResponderAnim(), {
      duration: 250,
      toValue: {x: (dims.width / 10) * 9, y: gestureState.dy},
      useNativeDriver: Platform.OS !== "web",
    }).start(() => onDestroy());
  };

  const getPanResponder = () => {
    if (panResponderRef.current) return panResponderRef.current;
    const swipeThreshold = Platform.OS === "android" ? 10 : 0;
    panResponderRef.current = PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        //return true if user is swiping, return false if it's a single click
        return (
          Math.abs(gestureState.dx) > swipeThreshold || Math.abs(gestureState.dy) > swipeThreshold
        );
      },
      onPanResponderMove: (_, gestureState) => {
        getPanResponderAnim()?.setValue({
          x: gestureState.dx,
          y: gestureState.dy,
        });
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > 50) {
          panReleaseToRight(gestureState);
        } else if (gestureState.dx < -50) {
          panReleaseToLeft(gestureState);
        } else {
          Animated.spring(getPanResponderAnim(), {
            toValue: {x: 0, y: 0},
            useNativeDriver: Platform.OS !== "web",
          }).start();
        }
      },
    });
    return panResponderRef.current;
  };

  const getPanResponderAnim = () => {
    if (panResponderAnimRef.current) return panResponderAnimRef.current;
    panResponderAnimRef.current = new Animated.ValueXY({x: 0, y: 0});
    return panResponderAnimRef.current;
  };

  if (icon === undefined) {
    switch (type) {
      case "success": {
        if (successIcon) {
          icon = successIcon;
        }
        break;
      }

      case "danger": {
        if (dangerIcon) {
          icon = dangerIcon;
        }
        break;
      }
      case "warning": {
        if (warningIcon) {
          icon = warningIcon;
        }
        break;
      }
    }
  }

  let backgroundColor = "";
  switch (type) {
    case "success":
      backgroundColor = successColor || "rgb(46, 125, 50)";
      break;
    case "danger":
      backgroundColor = dangerColor || "rgb(211, 47, 47)";
      break;
    case "warning":
      backgroundColor = warningColor || "rgb(237, 108, 2)";
      break;
    default:
      backgroundColor = normalColor || "#333";
  }

  // Build transform array with proper typing for React Native Animated
  type TransformItem =
    | {translateY?: Animated.AnimatedInterpolation<number>}
    | {translateX?: Animated.Value}
    | {scale?: Animated.AnimatedInterpolation<number>};

  const baseTransform: TransformItem[] = [
    {
      translateY: animation.interpolate({
        inputRange: [0, 1],
        outputRange: placement === "bottom" ? [20, 0] : [-20, 0],
      }),
    },
  ];

  if (swipeEnabled) {
    const panTransform = getPanResponderAnim().getTranslateTransform()[0];
    baseTransform.push(panTransform as TransformItem);
  }

  if (animationType === "zoom-in") {
    baseTransform.push({
      scale: animation.interpolate({
        inputRange: [0, 1],
        outputRange: [0.7, 1],
      }),
    });
  }

  const animationStyle = {
    opacity: animation,
    transform: baseTransform as Animated.WithAnimatedObject<ViewStyle>["transform"],
  };

  return (
    <Animated.View
      ref={containerRef}
      {...(swipeEnabled ? getPanResponder().panHandlers : null)}
      style={[toastStyles.container, animationStyle]}
    >
      {props.renderType?.[type] ? (
        props.renderType[type](props)
      ) : props.renderToast ? (
        props.renderToast(props)
      ) : (
        <TouchableWithoutFeedback disabled={!onPress} onPress={() => onPress?.(id)}>
          <View
            style={[
              toastStyles.toastContainer,
              {backgroundColor, maxWidth: (dims.width / 10) * 9},
              style,
            ]}
          >
            {icon ? <View style={toastStyles.iconContainer}>{icon}</View> : null}
            {React.isValidElement(message) ? (
              message
            ) : (
              <Text style={[toastStyles.message, textStyle]}>{message}</Text>
            )}
          </View>
        </TouchableWithoutFeedback>
      )}
    </Animated.View>
  );
};

const toastStyles = StyleSheet.create({
  container: {alignItems: "center", pointerEvents: "box-none", width: "100%"},
  iconContainer: {
    marginRight: 5,
  },
  message: {
    color: "#fff",
    fontWeight: "500",
  },
  toastContainer: {
    alignItems: "center",
    borderRadius: 5,
    flexDirection: "row",
    marginVertical: 5,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
});

// ============================================================================
// Toast Container
// ============================================================================

const {height, width} = Dimensions.get("window");

export interface ToastContainerProps extends ToastOptions {
  renderToast?(toast: ToastProps): ReactElement;
  renderType?: {[type: string]: (toast: ToastProps) => ReactElement};
  offset?: number;
  offsetTop?: number;
  offsetBottom?: number;
  swipeEnabled?: boolean;
}

export interface ToastContainerRef {
  show: (message: string | ReactElement, toastOptions?: ToastOptions) => string;
  update: (id: string, message: string | ReactElement, toastOptions?: ToastOptions) => void;
  hide: (id: string) => void;
  hideAll: () => void;
  isOpen: (id: string) => boolean;
}

const ToastContainer = forwardRef<ToastContainerRef, ToastContainerProps>((props, ref) => {
  const {
    offset = 10,
    offsetTop,
    offsetBottom,
    placement = "bottom",
    swipeEnabled = true,
    renderToast,
    renderType,
    duration,
    type,
    style,
    textStyle,
    animationDuration,
    animationType,
    successIcon,
    dangerIcon,
    warningIcon,
    successColor,
    dangerColor,
    warningColor,
    normalColor,
    onPress,
    data,
  } = props;

  const toastDefaults = useMemo(
    () => ({
      animationDuration,
      animationType,
      dangerColor,
      dangerIcon,
      data,
      duration,
      normalColor,
      onPress,
      renderToast,
      renderType,
      style,
      successColor,
      successIcon,
      textStyle,
      type,
      warningColor,
      warningIcon,
    }),
    [
      renderToast,
      renderType,
      duration,
      type,
      style,
      textStyle,
      animationDuration,
      animationType,
      successIcon,
      dangerIcon,
      warningIcon,
      successColor,
      dangerColor,
      warningColor,
      normalColor,
      onPress,
      data,
    ]
  );

  const [toasts, setToasts] = useState<Array<ToastProps>>([]);

  // `show` defers insertion to the next frame, so a `hide` can arrive before the
  // toast it targets exists in state. These track ids whose insertion is still
  // scheduled, and of those, the ones that have since been hidden — without
  // them the deferred insert would resurrect an already-hidden toast, leaving it
  // stuck on screen forever (persistent toasts never time out).
  const pendingShowsRef = useRef<Set<string>>(new Set());
  const cancelledShowsRef = useRef<Set<string>>(new Set());

  const hide = useCallback((id: string) => {
    if (pendingShowsRef.current.has(id)) {
      cancelledShowsRef.current.add(id);
    }
    setToasts((prev) => prev.map((t) => (t.id === id ? {...t, open: false} : t)));
  }, []);

  const show = useCallback(
    (message: string | ReactElement, toastOptions?: ToastOptions) => {
      const id = toastOptions?.id || Math.random().toString();
      const onDestroy = () => {
        toastOptions?.onClose?.();
        setToasts((prev) => prev.filter((t) => t.id !== id));
      };

      // Re-showing an id supersedes any hide that raced ahead of it.
      cancelledShowsRef.current.delete(id);
      pendingShowsRef.current.add(id);

      requestAnimationFrame(() => {
        pendingShowsRef.current.delete(id);
        if (cancelledShowsRef.current.delete(id)) {
          return;
        }
        setToasts((prev) => [
          {
            id,
            message,
            onDestroy,
            onHide: () => hide(id),
            open: true,
            placement,
            swipeEnabled,
            ...toastDefaults,
            ...toastOptions,
          },
          // Replace rather than stack any toast already using this id, so a
          // caller-supplied id always maps to exactly one toast on screen.
          ...prev.filter((t) => t.open && t.id !== id),
        ]);
      });

      return id;
    },
    [hide, placement, swipeEnabled, toastDefaults]
  );

  const update = useCallback(
    (id: string, message: string | ReactElement, toastOptions?: ToastOptions) => {
      setToasts((prev) =>
        prev.map((toast) => (toast.id === id ? {...toast, message, ...toastOptions} : toast))
      );
    },
    []
  );

  const hideAll = useCallback(() => {
    for (const id of pendingShowsRef.current) {
      cancelledShowsRef.current.add(id);
    }
    setToasts((prev) => prev.map((t) => ({...t, open: false})));
  }, []);

  const isOpen = useCallback(
    (id: string) => {
      return toasts.some((t) => t.id === id && t.open);
    },
    [toasts]
  );

  useImperativeHandle(
    ref,
    () => ({
      hide,
      hideAll,
      isOpen,
      show,
      update,
    }),
    [show, update, hide, hideAll, isOpen]
  );

  const renderBottomToasts = useCallback(() => {
    const style: ViewStyle = {
      bottom: offsetBottom || offset,
      flexDirection: "column",
      justifyContent: "flex-end",
      width: width,
    };
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "position" : undefined}
        style={[containerStyles.container, style]}
      >
        <SafeAreaView>
          {toasts
            .filter((t) => !t.placement || t.placement === "bottom")
            .map((toast) => (
              <ToastItem key={toast.id} {...toast} />
            ))}
        </SafeAreaView>
      </KeyboardAvoidingView>
    );
  }, [toasts, offset, offsetBottom]);

  const renderTopToasts = useCallback(() => {
    const style: ViewStyle = {
      flexDirection: "column-reverse",
      justifyContent: "flex-start",
      top: offsetTop || offset,
      width: width,
    };
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "position" : undefined}
        style={[containerStyles.container, style]}
      >
        <SafeAreaView>
          {toasts
            .filter((t) => t.placement === "top")
            .map((toast) => (
              <ToastItem key={toast.id} {...toast} />
            ))}
        </SafeAreaView>
      </KeyboardAvoidingView>
    );
  }, [toasts, offset, offsetTop]);

  const renderCenterToasts = useCallback(() => {
    const style: ViewStyle = {
      flexDirection: "column-reverse",
      height: height,
      justifyContent: "center",
      top: offsetTop || offset,
      width: width,
    };

    const data = toasts.filter((t) => t.placement === "center");
    const foundToast = data.length > 0;

    if (!foundToast) return null;

    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "position" : undefined}
        style={[containerStyles.container, style]}
      >
        {toasts
          .filter((t) => t.placement === "center")
          .map((toast) => (
            <ToastItem key={toast.id} {...toast} />
          ))}
      </KeyboardAvoidingView>
    );
  }, [toasts, offset, offsetTop]);

  const toastStack = (
    <>
      {renderTopToasts()}
      {renderBottomToasts()}
      {renderCenterToasts()}
    </>
  );

  // react-native-web Modal appends its own node to document.body (z-index 9999).
  // A position:fixed toast left in the app tree stays behind that layer and inherits
  // the backdrop dim. Portal the same container to document.body so its z-index wins.
  // Native keeps the in-tree absolute container.
  if (Platform.OS !== "web") {
    return toastStack;
  }

  const portalTarget = resolveDocumentBodyPortalTarget();
  if (!portalTarget) {
    return toastStack;
  }

  return createWebPortal({children: toastStack, container: portalTarget});
});

ToastContainer.displayName = "ToastContainer";

const containerStyles = StyleSheet.create({
  container: {
    alignSelf: "center",
    elevation: 999999,
    flex: 0,
    maxWidth: "100%",
    // box-none lets clicks pass through the full-width container to the page below,
    // while individual toasts stay interactive.
    pointerEvents: "box-none",
    // @ts-expect-error: fixed is available on web.
    position: Platform.OS === "web" ? "fixed" : "absolute",
    zIndex: 999999,
    ...(Platform.OS === "web" ? {overflow: "hidden", userSelect: "none"} : null),
  },
  message: {
    color: "#333",
  },
});

// ============================================================================
// Toast Context and Hook
// ============================================================================

export type ToastType = ToastContainerRef;

const ToastContext = createContext<ToastType>({} as ToastType);

export let GlobalToast: ToastType;

type ToastProviderProps = ToastContainerProps & {
  children: React.ReactNode;
};

export const ToastProvider: FC<ToastProviderProps> = ({children, ...props}) => {
  const toastRef = useRef<ToastContainerRef>(null);
  const [refState, setRefState] = useState<ToastType>({} as ToastType);

  useEffect(() => {
    if (toastRef.current) {
      setRefState(toastRef.current);
      GlobalToast = toastRef.current;
    }
  }, []);

  return (
    <ToastContext.Provider value={refState}>
      {children}
      <ToastContainer ref={toastRef} {...props} />
    </ToastContext.Provider>
  );
};

export const useToastNotifications = (): ToastType => useContext(ToastContext);

export default ToastContainer;
