# `infra-conteneurs/` — seconde pile cloud

Infrastructure **conteneurisée**, indépendante de [`../infra/`](../infra/) qui
continue de servir le site public sur S3 + CloudFront.

> **Le mode d'emploi complet est dans [`../DEPLOY_CONTENEURS.md`](../DEPLOY_CONTENEURS.md).**
> Cette page n'est qu'une carte du dossier.

---

## Carte

| Fichier | Ce qu'il monte |
|---|---|
| `versions.tf` | Fournisseurs, étiquetage, garanties de non-collision avec `infra/` |
| `variables.tf` | Tous les réglages, avec la raison de chaque valeur par défaut |
| `reseau.tf` | VPC dédié `10.42.0.0/16`, 2 zones, groupes de sécurité en deux étages |
| `ecr.tf` | Registre d'images privé + purge automatique |
| `secrets.tf` | Secret applicatif — Terraform crée le contenant, jamais le contenu |
| `dns.tf` | Certificat régional + **un seul** enregistrement dans la zone partagée |
| `alb.tf` | Répartiteur de charge, TLS, redirection 80 → 443 |
| `ecs.tf` | Cluster Fargate, définition de tâche, service, mise à l'échelle |
| `eks.tf` | Kubernetes managé — **éteint par défaut**, voir plus bas |
| `ses.tf` | Expédition de courriel, sur un sous-domaine dédié |
| `observabilite.tf` | 3 alarmes, 1 sujet SNS, 1 tableau de bord |
| `oidc.tf` | Rôle de déploiement GitHub, sans aucune clé permanente |
| `outputs.tf` | Ce qu'il faut reporter dans GitHub, et le bilan de cohabitation |
| `kubernetes/` | Manifestes kustomize — [README dédié](kubernetes/README.md) |

---

## Les cinq décisions qui expliquent le reste

1. **État Terraform séparé.** Cette pile ne lit pas celui de `infra/` et n'y a
   aucune référence : un `destroy` ici ne peut pas toucher ce qu'il ne connaît
   pas.

2. **Un seul enregistrement DNS ajouté** dans la zone partagée
   (`conteneurs.nexacode.store`), plus ceux de SES sous son propre sous-domaine.
   Le joker `*.nexacode.store` de `infra/` reste intact et continue de servir
   tous les autres noms. La sortie `cohabitation_avec_infra` le récapitule après
   chaque apply.

3. **Pas de passerelle NAT.** Elle coûterait plus cher que tout le reste réuni.
   Les tâches sont dans des sous-réseaux publics ; ce qui les protège est le
   groupe de sécurité, qui n'accepte que le répartiteur. Une adresse publique
   sans port ouvert n'est joignable par personne. À revoir le jour où la pile
   hébergera une base de données.

4. **EKS éteint par défaut.** Le plan de contrôle est facturé à l'heure, qu'il
   serve du trafic ou non. Les manifestes de `kubernetes/` tournent à
   l'identique sur un cluster local : on démontre Kubernetes gratuitement et on
   allume EKS le jour où il sert. Le code est écrit et testé, il ne manque
   qu'un `activer_eks = true`.

5. **Aucun secret dans le dépôt ni dans l'état.** Terraform crée le secret vide
   et n'y touche plus (`ignore_changes`). Les valeurs se posent à la main, une
   fois. La seule exception est l'utilisateur IAM pour SES — désactivé par
   défaut, avec l'avertissement qui va avec.

---

## Démarrage rapide

```bash
cp infra-conteneurs/terraform.tfvars.example infra-conteneurs/terraform.tfvars
```

```bash
terraform -chdir=infra-conteneurs init
```

```bash
terraform -chdir=infra-conteneurs plan -out=tfplan
```

Le seul verdict qui compte au bas du plan : **aucune destruction**. Si
`destroy` apparaît, s'arrêter et comprendre avant d'appliquer.

```bash
terraform -chdir=infra-conteneurs apply tfplan
```

Puis renseigner le secret applicatif et les variables GitHub — §5.4 et §6 de
[`../DEPLOY_CONTENEURS.md`](../DEPLOY_CONTENEURS.md).

---

## Contrôles sans accès AWS

```bash
terraform -chdir=infra-conteneurs fmt -check -recursive
```

```bash
terraform -chdir=infra-conteneurs validate
```

```bash
kubectl kustomize infra-conteneurs/kubernetes/overlays/local
```
