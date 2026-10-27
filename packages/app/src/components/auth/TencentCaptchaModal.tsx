import { Modal, View, Pressable, Text, StyleSheet } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'

type Props = {
  visible: boolean
  appId: string
  onClose: () => void
  onVerified: (ticket: string, randstr: string) => void
}

function captchaHtml(appId: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#fff"><script src="https://ssl.captcha.qq.com/TCaptcha.js"></script><script>
(function(){
  function send(obj){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(obj)); }
  document.addEventListener('DOMContentLoaded', function(){
    try {
      var c = new TencentCaptcha('${appId}', function(res){ send(res); });
      c.show();
    } catch(e){ send({ ret: -1, err: String(e) }); }
  });
})();
</script></body></html>`
}

export function TencentCaptchaModal({
  visible,
  appId,
  onClose,
  onVerified,
}: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  const onMsg = (e: WebViewMessageEvent) => {
    try {
      const res = JSON.parse(e.nativeEvent.data) as {
        ret: number
        ticket?: string
        randstr?: string
      }
      if (res.ret === 0 && res.ticket && res.randstr) {
        onVerified(res.ticket, res.randstr)
        onClose()
      } else if (res.ret !== 2) {
        onClose()
      }
    } catch {
      onClose()
    }
  }

  if (!visible) return null

  return (
    <Modal visible transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text style={{ color: colors.textTertiary }}>{t('close')}</Text>
          </Pressable>
          <WebView
            style={styles.web}
            source={{ html: captchaHtml(appId) }}
            onMessage={onMsg}
            javaScriptEnabled
            originWhitelist={['*']}
          />
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    height: '72%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  closeBtn: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  web: {
    flex: 1,
  },
})
