import type { Colors } from '../../hooks/useTheme'

export function getPinnedGroupPalette(colors: Colors, isDark: boolean) {
  return {
    backgroundColor: isDark ? `${colors.brand}14` : `${colors.brand}08`,
    borderColor: isDark ? `${colors.brand}24` : `${colors.brand}10`,
    separatorColor: isDark ? `${colors.brand}1e` : `${colors.brand}10`,
    iconColor: colors.brand,
  }
}
