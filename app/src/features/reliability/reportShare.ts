import {Share} from 'react-native';

export async function shareValidationReportText(reportText: string): Promise<void> {
  const text = reportText.trim();
  if (!text) {
    throw new Error('VALIDATION_REPORT_EMPTY');
  }

  await Share.share({
    title: 'Reliability Validation Report',
    message: text,
  });
}
