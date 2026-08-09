export interface AvatarPreset {
  id: string;
  label: string;
  category: AvatarCategory;
  url: string;
}

export type AvatarCategory = 'characters';

export const AVATAR_CATEGORIES: { value: AvatarCategory; label: string }[] = [
  { value: 'characters', label: 'Characters' },
];

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'char-1', label: 'Creative', category: 'characters', url: '/avatars/characters/creative-woman.png' },
  { id: 'char-2', label: 'Casual', category: 'characters', url: '/avatars/characters/casual-man.png' },
  { id: 'char-3', label: 'Tablet', category: 'characters', url: '/avatars/characters/tablet-woman.png' },
  { id: 'char-4', label: 'Jacket', category: 'characters', url: '/avatars/characters/jacket-man.png' },
  { id: 'char-5', label: 'Curly', category: 'characters', url: '/avatars/characters/curly-woman.png' },
  { id: 'char-6', label: 'Suit', category: 'characters', url: '/avatars/characters/suit-man.png' },
  { id: 'char-7', label: 'Blazer', category: 'characters', url: '/avatars/characters/blazer-woman.png' },
  { id: 'char-8', label: 'Executive', category: 'characters', url: '/avatars/characters/exec-man.png' },
  { id: 'char-9', label: 'Achiever', category: 'characters', url: '/avatars/characters/achiever-woman.png' },
  { id: 'char-10', label: 'Classic', category: 'characters', url: '/avatars/characters/classic-man.png' },
  { id: 'char-11', label: 'Security', category: 'characters', url: '/avatars/characters/security-woman.png' },
  { id: 'char-12', label: 'Tech', category: 'characters', url: '/avatars/characters/tech-man.png' },
];

export function getPresetsByCategory(category: AvatarCategory): AvatarPreset[] {
  return AVATAR_PRESETS.filter((p) => p.category === category);
}
