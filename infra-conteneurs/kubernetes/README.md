# Kubernetes — manifestes MUSÉA

Les **mêmes objets** tournent sur un cluster local et sur EKS. Seul l'overlay
change : ce qui est démontré sur le portable est ce qui tourne en production.

```
base/                 objets communs — ne s'applique jamais seul
overlays/local/       kind, minikube, Docker Desktop → NodePort 30080
overlays/eks/         EKS → répartiteur de charge, IRSA, image ECR
```

---

## Démonstration locale, sans un centime

Un cluster Kubernetes tourne sur le portable : Docker Desktop (cocher
*Settings → Kubernetes → Enable Kubernetes*) ou `kind create cluster`.

**1. Construire l'image**

```bash
docker build -t musea:local --build-arg VITE_SUPABASE_URL=https://xxxx.supabase.co --build-arg VITE_SUPABASE_ANON_KEY=sb_publishable_xxx .
```

Sous `kind` seulement, l'image doit être injectée dans le cluster — il ne voit
pas le démon Docker du poste :

```bash
kind load docker-image musea:local
```

**2. Appliquer**

```bash
kubectl apply -k infra-conteneurs/kubernetes/overlays/local
```

```bash
kubectl -n musea rollout status deployment/musea
```

Le site répond sur <http://localhost:30080>, la sonde sur
<http://localhost:30080/sante>.

---

## Ce qu'il y a à montrer — trois minutes, trois idées

### 1. La panne rattrapée toute seule

```bash
kubectl -n musea delete pod -l app.kubernetes.io/name=musea --wait=false
```

Dans un autre terminal, `kubectl -n musea get pods -w` : un pod remplaçant est
créé avant que le site ne cesse de répondre. C'est le `PodDisruptionBudget`
(`minAvailable: 1`) qui l'impose, pas la chance.

### 2. La mise à jour sans coupure

```bash
kubectl -n musea set image deployment/musea musea=musea:local --record
```

`maxUnavailable: 0` : Kubernetes ajoute un pod neuf, attend qu'il passe la
sonde de disponibilité, **puis seulement** retire l'ancien. Interroger
`/sante` en boucle pendant l'opération ne produit aucune erreur.

Et le retour arrière :

```bash
kubectl -n musea rollout undo deployment/musea
```

### 3. La montée en charge

```bash
kubectl -n musea get hpa musea -w
```

L'autoscaler a besoin du **metrics-server**, absent des clusters locaux par
défaut. Sans lui, la colonne des cibles affiche `<unknown>` et rien ne monte :

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

Sur un cluster local, il faut en général lui passer `--kubelet-insecure-tls`
(certificats auto-signés). Sur EKS, il s'installe proprement en extension.

---

## Choix inscrits dans les manifestes

| Réglage | Pourquoi, et ce qui arrive sans lui |
|---|---|
| `maxUnavailable: 0` | Zéro coupure au déploiement. Le défaut (25 %) accepte de réduire la capacité en pleine bascule. |
| `progressDeadlineSeconds: 180` | Un déploiement bloqué devient un **échec visible** ; sinon il attend en silence, et la CI aussi. |
| readiness ≠ liveness | Readiness retire du trafic, liveness **redémarre**. Une liveness trop nerveuse transforme une surcharge passagère en panne réelle. |
| `requests` sans limite de CPU | Sans `requests`, l'ordonnanceur entasse jusqu'à saturer le nœud. Une limite de CPU, elle, provoque du bridage même sur un nœud inoccupé. |
| Limite de mémoire, oui | C'est la mémoire qui tue le nœud quand elle déborde. |
| `topologySpreadConstraints` | Sans elle, l'ordonnanceur a le droit de poser les deux répliques sur le même nœud : la redondance devient décorative. `ScheduleAnyway` pour qu'un cluster à un seul nœud reste utilisable. |
| `automountServiceAccountToken: false` | Un frontal statique n'a rien à dire à l'API Kubernetes. Le jeton monté par défaut offrirait, en cas de compromission, un point de départ vers le reste du cluster. Exception sur EKS : IRSA a besoin du jeton. |
| `pod-security: restricted` | Appliqué au **namespace**, il refuse à l'admission tout manifeste ajouté plus tard qui demanderait des privilèges. |
| Volumes `emptyDir` | Le conteneur ne dépend d'aucun disque : n'importe quel nœud peut l'accueillir. |

---

## Sur EKS

Deux valeurs à substituer après `terraform apply` :

| Fichier | Marqueur | Sortie Terraform |
|---|---|---|
| `overlays/eks/kustomization.yaml` | `REMPLACER_PAR_LA_SORTIE_registre_ecr` | `registre_ecr` |
| `overlays/eks/serviceaccount-irsa.yaml` | `REMPLACER_PAR_LA_SORTIE_role_irsa` | `cluster_kubernetes.role_irsa` |

La CI ne modifie pas ces fichiers dans le dépôt : elle les substitue dans le
runner, juste avant d'appliquer.

```bash
aws eks update-kubeconfig --name musea-conteneurs-production-k8s --region eu-west-3
```

```bash
kubectl apply -k infra-conteneurs/kubernetes/overlays/eks
```

### Entrée HTTPS

`service-lb.yaml` crée un **NLB**, géré par le contrôleur intégré à EKS : rien
à installer, mais pas de terminaison TLS ni de routage par chemin.

Pour un vrai ALB avec certificat ACM, voir `exemple-ingress-alb.yaml` — il
exige le **contrôleur AWS Load Balancer**, qui ne fait pas partie d'EKS et
s'installe par Helm. Tant qu'il n'est pas là, l'Ingress reste sans adresse et
**rien ne l'indique** : c'est le piège classique.

### Les secrets sur EKS

Ne jamais recopier un secret dans un objet `Secret` : il est lisible par
quiconque peut lire le namespace et apparaît en clair dans un
`kubectl get -o yaml`. Monter Secrets Manager par le pilote CSI :

```bash
helm install csi-secrets-store secrets-store-csi-driver/secrets-store-csi-driver -n kube-system
```

puis l'extension AWS `secrets-store-csi-driver-provider-aws`. Le rôle IRSA
créé par Terraform sert de point de départ ; il faut lui attacher en plus la
politique `musea-conteneurs-<env>-lire-secret`.
