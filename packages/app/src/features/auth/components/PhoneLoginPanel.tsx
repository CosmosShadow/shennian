// @arch docs/architecture/app/modular-features.md#登录-feature
// @test src/__tests__/auth-providers.test.ts

import { useRef, useState } from 'react'
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Colors } from '../../../hooks/useTheme'
import {
  isPhoneLoginCodeComplete,
  isPhoneLoginNumberComplete,
} from '../utils/phoneLoginValidation'

type Props = {
  presentation?: 'default' | 'desktop'
  submitLabel?: string
  phone: string
  setPhone: (value: string) => void
  code: string
  setCode: (value: string) => void
  countdown: number
  sendingCode: boolean
  loading: boolean
  onSendCode: () => void | Promise<void>
  onLogin: () => void | Promise<void>
  colors: Colors
}

export function PhoneLoginPanel({
  presentation = 'default',
  submitLabel,
  phone,
  setPhone,
  code,
  setCode,
  countdown,
  sendingCode,
  loading,
  onSendCode,
  onLogin,
  colors,
}: Props) {
  const { t } = useTranslation()
  const [focusedField, setFocusedField] = useState<'phone' | 'code' | null>(null)
  const codeInputRef = useRef<TextInput>(null)
  const phoneComplete = isPhoneLoginNumberComplete(phone)
  const codeComplete = isPhoneLoginCodeComplete(code)
  const sendCodeDisabled = countdown > 0 || !phoneComplete || sendingCode
  const loginDisabled = !phoneComplete || !codeComplete || loading


  if (Platform.OS !== 'web' || presentation === 'desktop') {
    return (
      <>
        <Text style={[styles.nativeLabel, { color: colors.text }]}>{t('phone_field_label')}</Text>
        <View
          style={[
            styles.nativeField,
            {
              backgroundColor: colors.surface,
              borderColor: focusedField === 'phone' ? colors.brand : colors.border,
            },
          ]}
        >
          <Text style={[styles.nativeFieldPrefix, { color: colors.textSecondary }]}>+86</Text>
          <View style={[styles.nativeFieldDivider, { backgroundColor: colors.border }]} />
          <TextInput
            testID="phone-input"
            accessibilityLabel={t('phone_field_label')}
            style={[styles.nativeFieldInput, { color: colors.text }]}
            placeholder={t('phone_placeholder')}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.brand}
            keyboardType={Platform.OS === 'android' ? 'phone-pad' : 'number-pad'}
            textContentType="telephoneNumber"
            returnKeyType="next"
            maxLength={11}
            value={phone}
            onFocus={() => setFocusedField('phone')}
            onBlur={() => setFocusedField(null)}
            onChangeText={(value) => setPhone(value.replace(/\D/g, ''))}
            onSubmitEditing={() => codeInputRef.current?.focus()}
          />
        </View>

        <Text style={[styles.nativeLabel, styles.nativeCodeLabel, { color: colors.text }]}>
          {t('code_field_label')}
        </Text>
        <View
          style={[
            styles.nativeField,
            {
              backgroundColor: colors.surface,
              borderColor: focusedField === 'code' ? colors.brand : colors.border,
            },
          ]}
        >
          <TextInput
            ref={codeInputRef}
            testID="code-input"
            accessibilityLabel={t('code_field_label')}
            style={[styles.nativeFieldInput, styles.nativeCodeInput, { color: colors.text }]}
            placeholder={t('code_placeholder')}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.brand}
            keyboardType={Platform.OS === 'android' ? 'phone-pad' : 'number-pad'}
            textContentType="oneTimeCode"
            returnKeyType="done"
            maxLength={6}
            value={code}
            onFocus={() => setFocusedField('code')}
            onBlur={() => setFocusedField(null)}
            onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
            onSubmitEditing={() => {
              if (!loginDisabled) void onLogin()
            }}
          />
          <Pressable
            testID="send-code-btn"
            accessibilityRole="button"
            accessibilityState={{ busy: sendingCode, disabled: sendCodeDisabled }}
            style={styles.nativeSendAction}
            hitSlop={4}
            onPress={() => void onSendCode()}
            disabled={sendCodeDisabled}
          >
            {sendingCode ? (
              <ActivityIndicator color={colors.brand} size="small" />
            ) : (
              <Text
                style={[
                  styles.nativeSendActionText,
                  { color: sendCodeDisabled ? colors.textTertiary : colors.brand },
                ]}
              >
                {countdown > 0 ? t('resend_code', { seconds: countdown }) : t('get_code')}
              </Text>
            )}
          </Pressable>
        </View>

        <Pressable
          testID="login-btn"
          accessibilityRole="button"
          accessibilityState={{ busy: loading, disabled: loginDisabled }}
          style={({ pressed }) => [
            styles.nativeLoginBtn,
            {
              backgroundColor: loginDisabled
                ? colors.brandLight
                : pressed
                  ? colors.brandDark
                  : colors.brand,
            },
          ]}
          onPress={() => void onLogin()}
          disabled={loginDisabled}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text
              style={[styles.nativeLoginBtnText, { color: loginDisabled ? colors.brand : '#fff' }]}
            >
              {submitLabel ?? t('login_btn')}
            </Text>
          )}
        </Pressable>
      </>
    )
  }

  return (
    <>
      <View style={styles.phoneRow}>
        <Text
          style={[
            styles.prefix,
            Platform.OS !== 'web' && styles.nativePrefix,
            { color: colors.textTertiary },
          ]}
        >
          +86
        </Text>
        <TextInput
          testID="phone-input"
          accessibilityLabel={t('phone_field_label')}
          style={[
            styles.input,
            Platform.OS !== 'web' && styles.nativeInput,
            styles.phoneInput,
            {
              color: colors.text,
              borderColor: colors.border,
              backgroundColor: colors.surfaceHover,
            },
          ]}
          placeholder={t('phone_placeholder')}
          placeholderTextColor={colors.textTertiary}
          keyboardType="number-pad"
          maxLength={11}
          value={phone}
          onChangeText={(value) => setPhone(value.replace(/\D/g, ''))}
        />
      </View>

      <View style={styles.codeRow}>
        <TextInput
          testID="code-input"
          accessibilityLabel={t('code_field_label')}
          style={[
            styles.input,
            Platform.OS !== 'web' && styles.nativeInput,
            styles.codeInput,
            {
              color: colors.text,
              borderColor: colors.border,
              backgroundColor: colors.surfaceHover,
            },
          ]}
          placeholder={t('code_placeholder')}
          placeholderTextColor={colors.textTertiary}
          keyboardType="number-pad"
          maxLength={6}
          value={code}
          onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
        />
        <Pressable
          testID="send-code-btn"
          accessibilityRole="button"
          accessibilityState={{ busy: sendingCode, disabled: sendCodeDisabled }}
          style={[
            styles.sendBtn,
            { backgroundColor: colors.brand },
            sendCodeDisabled && styles.btnDisabled,
          ]}
          onPress={() => void onSendCode()}
          disabled={sendCodeDisabled}
        >
          {sendingCode ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.sendBtnText}>
              {countdown > 0 ? t('resend_code', { seconds: countdown }) : t('send_code')}
            </Text>
          )}
        </Pressable>
      </View>

      <Pressable
        testID="login-btn"
        accessibilityRole="button"
        accessibilityState={{ busy: loading, disabled: loginDisabled }}
        style={[
          styles.loginBtn,
          { backgroundColor: colors.brand },
          loginDisabled && styles.btnDisabled,
        ]}
        onPress={() => void onLogin()}
        disabled={loginDisabled}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.loginBtnText}>{submitLabel ?? t('login_btn')}</Text>
        )}
      </Pressable>
    </>
  )
}

const styles = StyleSheet.create({
  nativeLabel: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    marginBottom: 8,
  },
  nativeCodeLabel: {
    marginTop: 24,
  },
  nativeField: {
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  nativeFieldPrefix: {
    width: 56,
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 22,
  },
  nativeFieldDivider: {
    width: StyleSheet.hairlineWidth,
    height: 24,
  },
  nativeFieldInput: {
    flex: 1,
    height: 48,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  nativeCodeInput: {
    minWidth: 0,
  },
  nativeSendAction: {
    minWidth: 96,
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  nativeSendActionText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  nativeLoginBtn: {
    height: 48,
    borderRadius: 12,
    marginTop: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nativeLoginBtnText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  prefix: {
    fontSize: 14,
    position: 'absolute',
    left: 16,
    zIndex: 1,
  },
  nativePrefix: {
    fontSize: 16,
  },
  input: {
    flex: 1,
    fontSize: 14,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 50,
  },
  nativeInput: {
    fontSize: 17,
  },
  phoneInput: {
    paddingLeft: 58,
  },
  codeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  codeInput: { minWidth: 0 },
  sendBtn: {
    borderRadius: 12,
    paddingHorizontal: 16,
    minHeight: 50,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 88,
  },
  sendBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  loginBtn: {
    borderRadius: 12,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.5,
  },
})
