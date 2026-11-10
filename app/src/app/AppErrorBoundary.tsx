import {Component, ErrorInfo, Fragment, ReactNode} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';

import {describeError, logDiagnostic} from '../platform/diagnostics';
import {colors, radii, spacing} from '../ui/theme';

type Props = {children: ReactNode};
type State = {error: Error | null; resetCount: number};

/**
 * Catches render and effect errors anywhere below it, logs them to the on-device diagnostics,
 * and offers to rebuild the UI. Playback lives in the native service, so music keeps going.
 * Deliberately uses static styles: the theme provider may be what failed.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = {error: null, resetCount: 0};

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {error};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const {message, stack} = describeError(error);
    logDiagnostic('error', 'render', message, {stack, componentStack: info.componentStack ?? ''});
  }

  private readonly reset = () => {
    this.setState(current => ({error: null, resetCount: current.resetCount + 1}));
  };

  render() {
    const {error, resetCount} = this.state;
    if (error) {
      return (
        <View style={styles.container} testID="app-error-fallback">
          <Text style={styles.title}>Something went wrong on this screen</Text>
          <Text style={styles.body}>Music keeps playing. The problem was saved to the diagnostics log.</Text>
          <Text style={styles.detail} numberOfLines={4}>
            {describeError(error).message}
          </Text>
          <Pressable
            accessibilityRole="button"
            testID="app-error-reload"
            onPress={this.reset}
            style={({pressed}) => [styles.button, pressed && styles.buttonPressed]}>
            <Text style={styles.buttonText}>RELOAD SCREEN</Text>
          </Pressable>
        </View>
      );
    }
    // A new key remounts the whole tree, so state that caused the error is discarded.
    return <Fragment key={resetCount}>{this.props.children}</Fragment>;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: colors.backgroundBase,
  },
  title: {color: colors.textPrimary, fontSize: 20, fontWeight: '700'},
  body: {color: colors.textSecondary, fontSize: 15},
  detail: {color: colors.textMuted, fontSize: 13},
  button: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.accentPrimary,
  },
  buttonPressed: {opacity: 0.8},
  buttonText: {color: colors.backgroundBase, fontWeight: '700'},
});
