# Void Chronicle - 초기 설정 파일

## 📦 package.json

```json
{
  "name": "void-chronicle",
  "version": "0.1.0",
  "description": "A 2D roguelike action RPG built with Phaser 3 and TypeScript",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
    "lint:fix": "eslint . --ext ts,tsx --fix",
    "format": "prettier --write \"src/**/*.{ts,tsx,json}\"",
    "format:check": "prettier --check \"src/**/*.{ts,tsx,json}\"",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "phaser": "^3.80.1"
  },
  "devDependencies": {
    "@types/node": "^20.11.19",
    "@typescript-eslint/eslint-plugin": "^7.0.1",
    "@typescript-eslint/parser": "^7.0.1",
    "@vitest/ui": "^1.3.1",
    "eslint": "^8.57.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-prettier": "^5.1.3",
    "prettier": "^3.2.5",
    "typescript": "^5.3.3",
    "vite": "^5.1.3",
    "vitest": "^1.3.1"
  },
  "keywords": [
    "phaser",
    "phaser3",
    "typescript",
    "roguelike",
    "game",
    "2d"
  ],
  "author": "Your Name",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/void-chronicle.git"
  }
}
```

---

## 🔧 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "noUncheckedIndexedAccess": true,

    /* Path mapping */
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@entities/*": ["./src/entities/*"],
      "@systems/*": ["./src/systems/*"],
      "@scenes/*": ["./src/scenes/*"],
      "@ui/*": ["./src/ui/*"],
      "@utils/*": ["./src/utils/*"],
      "@config/*": ["./src/config/*"],
      "@data/*": ["./src/data/*"],
      "@types/*": ["./src/types/*"],
      "@ai/*": ["./src/ai/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

---

## 🔧 tsconfig.node.json

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

---

## ⚡ vite.config.ts

```typescript
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@entities': path.resolve(__dirname, './src/entities'),
      '@systems': path.resolve(__dirname, './src/systems'),
      '@scenes': path.resolve(__dirname, './src/scenes'),
      '@ui': path.resolve(__dirname, './src/ui'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@config': path.resolve(__dirname, './src/config'),
      '@data': path.resolve(__dirname, './src/data'),
      '@types': path.resolve(__dirname, './src/types'),
      '@ai': path.resolve(__dirname, './src/ai'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
    target: 'es2020',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
      },
    },
  },
  server: {
    port: 3000,
    open: true,
    host: true, // Mobile testing
  },
  preview: {
    port: 4173,
    open: true,
  },
});
```

---

## 🧪 vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.config.ts',
        '**/types/',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@entities': path.resolve(__dirname, './src/entities'),
      '@systems': path.resolve(__dirname, './src/systems'),
      '@scenes': path.resolve(__dirname, './src/scenes'),
      '@ui': path.resolve(__dirname, './src/ui'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@config': path.resolve(__dirname, './src/config'),
      '@data': path.resolve(__dirname, './src/data'),
      '@types': path.resolve(__dirname, './src/types'),
      '@ai': path.resolve(__dirname, './src/ai'),
    },
  },
});
```

---

## 📝 .eslintrc.json

```json
{
  "env": {
    "browser": true,
    "es2021": true,
    "node": true
  },
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:prettier/recommended"
  ],
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": "latest",
    "sourceType": "module",
    "project": "./tsconfig.json"
  },
  "plugins": ["@typescript-eslint"],
  "rules": {
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_"
      }
    ],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "no-console": ["warn", { "allow": ["warn", "error"] }]
  },
  "ignorePatterns": ["dist", "node_modules", "*.config.ts"]
}
```

---

## 🎨 .prettierrc

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

---

## 🚫 .gitignore

```
# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

# Dependencies
node_modules
.pnpm-store

# Build output
dist
dist-ssr
*.local

# Editor directories and files
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# Environment variables
.env
.env.local
.env.production

# Test coverage
coverage

# Vitest
.vitest

# OS
Thumbs.db
```

---

## 📄 public/index.html

```html
<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Void Chronicle - A 2D roguelike action RPG" />
    <meta name="theme-color" content="#000000" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <title>Void Chronicle</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      html,
      body {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background-color: #000;
      }

      body {
        display: flex;
        justify-content: center;
        align-items: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu,
          Cantarell, sans-serif;
      }

      #game-container {
        width: 100%;
        height: 100%;
        max-width: 100vw;
        max-height: 100vh;
      }

      /* Loading screen */
      #loading {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
        color: #fff;
        z-index: 1000;
      }

      #loading.hidden {
        display: none;
      }

      .spinner {
        border: 4px solid rgba(255, 255, 255, 0.3);
        border-radius: 50%;
        border-top: 4px solid #fff;
        width: 40px;
        height: 40px;
        animation: spin 1s linear infinite;
        margin: 0 auto 16px;
      }

      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }
    </style>
  </head>
  <body>
    <div id="loading">
      <div class="spinner"></div>
      <p>Loading Void Chronicle...</p>
    </div>
    <div id="game-container"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

---

## 📚 README.md

```markdown
# Void Chronicle

A 2D roguelike action RPG built with Phaser 3 and TypeScript.

## 🎮 About

Void Chronicle is a roguelike dungeon crawler where you explore procedurally generated dungeons, fight enemies, collect items, and upgrade your character. Each run is unique, and death is permanent - but your progress carries over through meta-progression.

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm

### Installation

\`\`\`bash
# Clone the repository
git clone https://github.com/yourusername/void-chronicle.git
cd void-chronicle

# Install dependencies
pnpm install

# Start development server
pnpm dev
\`\`\`

The game will open at `http://localhost:3000`

### Build for Production

\`\`\`bash
pnpm build
pnpm preview
\`\`\`

## 🛠️ Tech Stack

- **Phaser 3** - Game framework
- **TypeScript** - Type-safe JavaScript
- **Vite** - Build tool
- **Vitest** - Unit testing

## 📁 Project Structure

\`\`\`
src/
├── scenes/       # Phaser scenes
├── entities/     # Game entities (player, enemies, items)
├── systems/      # Game systems (combat, inventory, dungeon generation)
├── ui/           # UI components
├── ai/           # Enemy AI
├── utils/        # Utilities
├── config/       # Game configuration
└── data/         # Game data (JSON)
\`\`\`

## 🎯 Game Features

- ✅ Procedurally generated dungeons
- ✅ Real-time combat system
- ✅ Multiple playable characters
- ✅ Item and equipment system
- ✅ Skill system with cooldowns
- ✅ Meta-progression (permanent upgrades)
- ✅ Permadeath with soul currency
- ✅ Touch controls for mobile

## 🧪 Testing

\`\`\`bash
# Run tests
pnpm test

# Run tests with UI
pnpm test:ui

# Generate coverage report
pnpm test:coverage
\`\`\`

## 📝 License

MIT

## 👥 Credits

- Game assets from [itch.io](https://itch.io)
- Sound effects from [freesound.org](https://freesound.org)
- Music from [incompetech.com](https://incompetech.com)
\`\`\`

---

## 🔐 .vscode/settings.json (추천)

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[json]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  }
}
```

---

## 🔌 .vscode/extensions.json (추천 확장)

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "streetsidesoftware.code-spell-checker",
    "vitest.explorer"
  ]
}
```

---

**참고**: 이 파일들을 복사하여 `void-chronicle` 프로젝트 디렉토리에 생성하세요.
