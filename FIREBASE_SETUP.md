# Compte Seven sur Firebase Spark

Seven utilise Firebase Authentication et Cloud Firestore; cette configuration ne requiert ni Cloud Functions ni Cloud Storage. Les photos sont réduites et enregistrées dans les fiches Firestore. Une connexion Internet est nécessaire pour la synchronisation; la copie locale est conservée en cache.

## Mise en service

1. Dans Firebase Authentication, active le fournisseur **E-mail/Mot de passe**.
2. Crée la base Cloud Firestore en choisissant **europe-west9 (Paris)**. La région d’une base Firestore ne peut pas être changée après sa création.
3. Vérifie les domaines autorisés dans Authentication > Paramètres et ajoute le domaine HTTPS où Seven est publié.
4. Depuis ce dossier, exécute `firebase login`, puis `firebase use --add` et sélectionne `compteseven7-b1ca5`.
5. Déploie les règles Firestore avec `firebase deploy --only firestore:rules`.
6. Publie `index.html`, `app.js`, `style.css` et `firebase-config.js` sur l’hébergement HTTPS actuel de Seven. Ne remplace pas cet hébergement par Firebase Hosting.

## Connexion et sécurité

Le prénom est l’identifiant visible; il doit être unique (insensible aux accents et à la casse). Firebase Auth utilise en interne une adresse synthétique basée sur le prénom et le projet. Le code à quatre chiffres est converti en mot de passe Firebase; il n’est pas envoyé à une fonction ni écrit dans Firestore.

Un PIN à quatre chiffres a seulement 10 000 combinaisons et est moins robuste qu’un vrai mot de passe. Il n’existe pas de récupération par e-mail pour les identifiants synthétiques; en cas d’oubli, les données de ce compte ne peuvent pas être récupérées sans assistance manuelle. Pour le premier accès, crée le compte avec ton prénom et `1411`, puis mémorise ce code.

À la première connexion, Seven propose d’importer les fiches présentes dans l’ancien stockage local. L’import ne supprime pas cette copie locale. Chaque compte n’accède qu’à ses propres documents Firestore grâce aux règles de sécurité.