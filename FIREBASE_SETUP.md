# Base Seven partagée et accès administrateur

Tous les visiteurs lisent la même collection `footballers`. Seul l’administrateur peut écrire; les règles Firestore appliquent cette restriction côté serveur. Le compte n’est pas un profil de joueurs distinct.

## État du projet

Le projet `compteseven7-b1ca5` est configuré : l’application Web Seven est enregistrée, E-mail/Mot de passe est activé, le compte admin existe, et la base Firestore Standard est créée en `europe-west9` (Paris). Les règles publiées autorisent la lecture publique et réservent les écritures au compte admin. Le forfait reste Spark; aucun bucket Storage, Cloud Function ou hébergement Firebase n’a été créé.

## Dernière étape : publier le site

Les règles Firestore sont déjà publiées. Il reste à republier `index.html`, `app.js`, `style.css` et `firebase-config.js` sur ton hébergeur HTTPS actuel; ne remplace pas cet hébergement par Firebase Hosting.

Si tu modifies plus tard `firestore.rules`, depuis ce dossier, exécute `firebase login`, sélectionne le projet `compteseven7-b1ca5` avec `firebase use --add`, puis lance `firebase deploy --only firestore:rules`.

## Accès

Dans Seven, l’identifiant affiché est **Célien** et le bouton **Accès admin** demande le PIN `1411`. L’application transforme le PIN en mot de passe Firebase conforme à la longueur minimale requise. L’utilisateur admin est déjà créé dans Firebase Authentication; l’application ne propose aucune inscription publique. Il est le seul autorisé à ajouter, modifier et supprimer les joueurs.

Au premier accès admin après publication, Seven proposera d’importer les joueurs locaux dans la collection commune. Vérifie le nombre affiché et accepte pour les partager; la copie locale de secours est conservée. Ensuite, toute modification admin se synchronise et apparaît chez les visiteurs.

## Limites et confidentialité

Le catalogue, les noms, les clubs, nationalités et photos sont lisibles par tous les visiteurs. N’y mets aucune information privée. Un PIN à quatre chiffres est faible; Firebase Auth limite les essais. Pour changer le PIN, mets à jour le mot de passe du compte administrateur dans Firebase Authentication et le code de conversion dans `app.js`.

Cette configuration utilise Firebase Authentication et Firestore Standard sur le forfait Spark; aucune Cloud Function ni Cloud Storage n’est nécessaire.