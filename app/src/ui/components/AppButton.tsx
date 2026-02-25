import {memo, useCallback, useMemo, useRef} from 'react';
import {Animated, Pressable, StyleSheet, Text, View} from 'react-native';

import {radii, spacing} from '../theme';
import {ThemeColors, useTheme} from '../themeRuntime';

type AppButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  testID?: string;
};

export const AppButton = memo(function AppButton({title, onPress, variant = 'secondary', disabled = false, testID}: AppButtonProps) {
  const {colors, fontFamily} = useTheme();
  const styles = useMemo(() => createStyles(colors, fontFamily), [colors, fontFamily]);
  const scaleValue = useRef(new Animated.Value(1)).current;

  const animateTo = useCallback((toValue: number) => {
    Animated.timing(scaleValue, {
      toValue,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }, [scaleValue]);

  const handlePressIn = useCallback(() => {
    if (!disabled) {
      animateTo(0.97);
    }
  }, [animateTo, disabled]);

  const handlePressOut = useCallback(() => {
    animateTo(1);
  }, [animateTo]);

  return (
    <Animated.View style={[styles.animationWrap, {transform: [{scale: scaleValue}]}]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={({pressed}) => [
          styles.base,
          variant === 'primary' ? styles.primary : styles.secondary,
          pressed && !disabled ? styles.pressed : null,
          disabled ? styles.disabled : null,
        ]}>
        <View style={[styles.gradientLayer, variant === 'primary' ? styles.primaryGradient : styles.secondaryGradient]} />
        <View style={styles.sheenLayer} />
        <Text style={[styles.label, variant === 'primary' ? styles.primaryLabel : styles.secondaryLabel]}>
          {title}
        </Text>
      </Pressable>
    </Animated.View>
  );
});

function createStyles(colors: ThemeColors, fontFamily: string) {
  return StyleSheet.create({
    animationWrap: {
      width: '100%',
    },
    base: {
      minHeight: 42,
      borderWidth: 1,
      borderRadius: radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      overflow: 'hidden',
    },
    primary: {
      borderColor: colors.accentPrimary,
      backgroundColor: colors.backgroundCard,
    },
    secondary: {
      borderColor: colors.borderStrong,
      backgroundColor: colors.backgroundElevated,
    },
    pressed: {
      opacity: 0.96,
    },
    disabled: {
      opacity: 0.45,
    },
    gradientLayer: {
      ...StyleSheet.absoluteFillObject,
      opacity: 0.75,
    },
    primaryGradient: {
      backgroundColor: `${colors.accentPrimary}22`,
    },
    secondaryGradient: {
      backgroundColor: `${colors.textSecondary}11`,
    },
    sheenLayer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: '45%',
      backgroundColor: `${colors.textPrimary}12`,
    },
    label: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.2,
      fontFamily,
    },
    primaryLabel: {
      color: colors.textPrimary,
    },
    secondaryLabel: {
      color: colors.textSecondary,
    },
  });
}
