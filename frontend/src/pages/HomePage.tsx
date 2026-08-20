import { Link } from 'react-router-dom'

import { useFarms } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export const HomePage = () => {
  const { data: farms = [], error, isLoading } = useFarms()

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,hsl(var(--secondary)),transparent_32rem)] px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Beslutningsstøtte til sædskifte
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
              Vælg en bedrift eller opret et nyt planlægningsområde
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
              Bedrifter er brugerdefinerede arbejdsområder. CVR-numre er
              valgfrie og kan bruges til at fokusere kortet, når du vælger
              marker fra registret.
            </p>
          </div>
          <Button asChild size="lg">
            <Link to="/farms/new">Opret ny bedrift</Link>
          </Button>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Dine bedrifter</CardTitle>
            <CardDescription>
              Vælg en bedrift for at gennemgå marker og tilføje marker fra
              registret.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground">Indlæser bedrifter...</p>
            ) : null}
            {error ? (
              <p className="text-sm text-red-700">
                Kunne ikke indlæse bedrifter.
              </p>
            ) : null}
            {!isLoading && farms.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <p className="text-lg font-medium">Ingen bedrifter endnu</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Opret din første bedrift for at vælge marker fra registret.
                </p>
                <Button asChild className="mt-5">
                  <Link to="/farms/new">Opret bedrift</Link>
                </Button>
              </div>
            ) : null}
            <div className="space-y-3">
              {farms.map((farm) => (
                <div
                  key={farm.id}
                  className="flex flex-col gap-4 rounded-lg border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-lg font-semibold">{farm.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {farm.ownerName}
                      {farm.cvr ? ` · CVR ${farm.cvr}` : ''}
                    </p>
                  </div>
                  <Button asChild variant="outline">
                    <Link to={`/farms/${farm.id}`}>Åbn</Link>
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
