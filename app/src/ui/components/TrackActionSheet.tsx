import {useMemo} from 'react';
import {Modal, Pressable, StyleSheet, Text, View} from 'react-native';

import {AppButton} from './AppButton';
import {radii, spacing} from '../theme';
import {ThemeColors, useTheme} from '../themeRuntime';

export type TrackActionSheetAction = {
  key: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
};

type TrackActionSheetProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  actions: TrackActionSheetAction[];
  onClose: () => void;
};

export function TrackActionSheet({visible, title, subtitle, actions, onClose}: TrackActionSheetProps) {
  const {colors, fontFamily} = useTheme();
  const styles = useMemo(() => createStyles(colors, fontFamily), [colors, fontFamily]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          <View style={styles.actions}>
            {actions.map(action => (
              <AppButton
                key={action.key}
                title={action.label}
                onPress={() => {
                  action.onPress();
                  onClose();
                }}
                disabled={action.disabled}
                variant={action.primary ? 'primary' : 'secondary'}
              />
            ))}
            <AppButton title="CLOSE" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(colors: ThemeColors, fontFamily: string) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.48)',
    },
    sheet: {
      borderTopLeftRadius: radii.lg,
      borderTopRightRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.backgroundCard,
      padding: spacing.lg,
      gap: spacing.xs,
    },
    title: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
      fontFamily,
    },
    subtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      fontFamily,
    },
    actions: {
      marginTop: spacing.sm,
      gap: spacing.sm,
    },
  });
}
