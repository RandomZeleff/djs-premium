# djs-premium

Un package vous permettant de gérer des abonnements premiums ! (discord ou autre..)

### Installation

```shell
npm install djs-premium
```

```ts
import { PremiumManager } from "djs-premium";

const Premium = new PremiumManager({
  storage: "mongo" | "local", // Stockage avec MongoDB ou en local via JSON. (requis)
  localDataDir: "./", // Dossier où les fichiers json seront créés. (requis si le storage local est utilisé)
  codeLength: 12, // Nombre de caractère d'un code premium.
  defaultPremiumDuration: 30, // Durée de premium par défaut lors de la création d'un code.
  maxActivationsPerCode: 1, // Nombre d'activation d'un code.
  preloadTables: true, // Permet de mettre en cache les données existantes lors du démarrage de l'application.
  cacheTTL: 0, // Durée de vie du cache. (en secondes)
});
```
